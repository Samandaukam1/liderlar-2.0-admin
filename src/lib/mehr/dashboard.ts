import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * MEHR admin ko'rsatkichlari va tekshiruv navbati.
 *
 * USTUNLAR ATMA-ATI SANALADI, `select("*")` ishlatilmaydi.
 * Tadbir qatorida tekshiruv koordinatalari bor va ular
 * brauzergacha yetib bormasligi kerak (§36).
 */

export interface ReviewQueueItem {
  id: string;
  title: string;
  status: string;
  organizerName: string;
  regionName: string | null;
  categoryName: string | null;
  submittedAt: string | null;
  startsAt: string | null;
  beneficiaryCount: number | null;
  participantCount: number;
  mediaCount: number;
  riskFlags: string[];
  /** Tashkilotchining avvalgi tarixi — takroriy soxta yuborishni ko'rish uchun. */
  organizerApprovedCount: number;
  organizerRejectedCount: number;
}

export interface MehrStats {
  volunteers: number;
  approvedActivities: number;
  certificates: number;
  totalPoints: number;
  pendingReview: number;
}

export interface MehrDashboard {
  stats: MehrStats;
  queue: ReviewQueueItem[];
}

interface ActivityRow {
  id: string;
  title: string;
  status: string;
  submitted_at: string | null;
  starts_at: string | null;
  beneficiary_count: number | null;
  risk_flags: unknown;
  organizer_profile_id: string;
  profiles: { full_name: string } | null;
  regions: { name: string } | null;
  mehr_categories: { name: string } | null;
}

export async function loadMehrDashboard(limit = 50): Promise<MehrDashboard> {
  const db = createSupabaseAdminClient();

  const [
    activitiesRes,
    approvedCountRes,
    certCountRes,
    pendingCountRes,
    volunteersRes,
    pointsRes,
  ] = await Promise.all([
    db
      .from("mehr_activities")
      .select(
        "id, title, status, submitted_at, starts_at, beneficiary_count, risk_flags, " +
          /*
           * FK nomi ATAYLAB yozilmadi. mehr_activities dan
           * profiles ga bitta bog'lanish bor, shuning uchun
           * PostgREST uni o'zi topadi. Nomni qo'lda yozish
           * uni taxmin qilish demak — noto'g'ri bo'lsa,
           * sahifa ishlash paytida yiqilardi.
           */
          "organizer_profile_id, profiles(full_name), " +
          "regions(name), mehr_categories(name)",
      )
      .eq("status", "submitted")
      .order("submitted_at", { ascending: true })
      .limit(limit),

    db.from("mehr_activities").select("id", { count: "exact", head: true }).eq("status", "approved"),
    db.from("certificates").select("id", { count: "exact", head: true }).eq("status", "active"),
    db.from("mehr_activities").select("id", { count: "exact", head: true }).eq("status", "submitted"),

    /*
     * VOLONTYOR = TASDIQLANGAN ISHTIROKI BOR ODAM.
     *
     * Ro'yxatdan o'tganlar soni emas: "volontyor" deb faqat
     * haqiqatan qatnashgan odam sanaladi (§46).
     */
    db.from("point_aggregates").select("profile_id", { count: "exact", head: true })
      .eq("period", "all").eq("period_key", "all").eq("category", "total").gt("total_points", 0),

    db.from("point_aggregates").select("total_points")
      .eq("period", "all").eq("period_key", "all").eq("category", "total"),
  ]);

  const rows = (activitiesRes.data ?? []) as unknown as ActivityRow[];
  const ids = rows.map((r) => r.id);
  const organizerIds = [...new Set(rows.map((r) => r.organizer_profile_id))];

  const [participantsRes, mediaRes, historyRes] = await Promise.all([
    ids.length
      ? db.from("mehr_participants").select("activity_id").in("activity_id", ids).eq("status", "checked_in")
      : Promise.resolve({ data: [] as { activity_id: string }[] }),
    ids.length
      ? db.from("mehr_media").select("activity_id").in("activity_id", ids)
      : Promise.resolve({ data: [] as { activity_id: string }[] }),
    organizerIds.length
      ? db
          .from("mehr_activities")
          .select("organizer_profile_id, status")
          .in("organizer_profile_id", organizerIds)
          .in("status", ["approved", "rejected"])
      : Promise.resolve({ data: [] as { organizer_profile_id: string; status: string }[] }),
  ]);

  const countBy = (list: { activity_id: string }[] | null) => {
    const map = new Map<string, number>();
    for (const r of list ?? []) map.set(r.activity_id, (map.get(r.activity_id) ?? 0) + 1);
    return map;
  };

  const participantCounts = countBy(participantsRes.data as { activity_id: string }[] | null);
  const mediaCounts = countBy(mediaRes.data as { activity_id: string }[] | null);

  const history = new Map<string, { approved: number; rejected: number }>();
  for (const r of (historyRes.data ?? []) as { organizer_profile_id: string; status: string }[]) {
    const entry = history.get(r.organizer_profile_id) ?? { approved: 0, rejected: 0 };
    if (r.status === "approved") entry.approved += 1;
    else entry.rejected += 1;
    history.set(r.organizer_profile_id, entry);
  }

  const queue: ReviewQueueItem[] = rows.map((row) => {
    const hist = history.get(row.organizer_profile_id) ?? { approved: 0, rejected: 0 };
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      organizerName: row.profiles?.full_name ?? "Noma'lum",
      regionName: row.regions?.name ?? null,
      categoryName: row.mehr_categories?.name ?? null,
      submittedAt: row.submitted_at,
      startsAt: row.starts_at,
      beneficiaryCount: row.beneficiary_count,
      participantCount: participantCounts.get(row.id) ?? 0,
      mediaCount: mediaCounts.get(row.id) ?? 0,
      riskFlags: Array.isArray(row.risk_flags) ? (row.risk_flags as string[]) : [],
      organizerApprovedCount: hist.approved,
      organizerRejectedCount: hist.rejected,
    };
  });

  const totalPoints = ((pointsRes.data ?? []) as { total_points: number }[]).reduce(
    (sum, r) => sum + Number(r.total_points ?? 0),
    0,
  );

  return {
    stats: {
      volunteers: volunteersRes.count ?? 0,
      approvedActivities: approvedCountRes.count ?? 0,
      certificates: certCountRes.count ?? 0,
      totalPoints,
      pendingReview: pendingCountRes.count ?? 0,
    },
    queue,
  };
}
