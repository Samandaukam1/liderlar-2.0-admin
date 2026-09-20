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

  /* ---- Tekshiruv dalillari (§11) ---- */

  /** Nechta ishtirok QR orqali qayd etilgan. */
  checkinCount: number;
  /** Nechtasining joyi tekshiruvdan o'tgan. Aniq koordinata EMAS. */
  locationVerifiedCount: number;
  requiresLocation: boolean;
  /** Seans umuman ochilganmi — QR ishlatilganini ko'rsatadi. */
  hadSession: boolean;

  /**
   * Tasdiqlansa qancha ball tarqaladi.
   *
   * Bu TAXMIN, qaror emas: haqiqiy hisob tasdiqlash
   * tranzaksiyasida, qoidalar jadvalidan chiqadi. Admin
   * "nima bo'lishini" oldindan ko'rishi uchun.
   */
  proposedPoints: number;
  proposedBreakdown: { role: string; count: number; points: number }[];
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
  requires_location: boolean;
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
        "id, title, status, submitted_at, starts_at, beneficiary_count, risk_flags, requires_location, " +
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

  const [participantsRes, mediaRes, historyRes, checkinsRes, sessionsRes, rulesRes] = await Promise.all([
    ids.length
      ? db
          .from("mehr_participants")
          .select("id, activity_id, role")
          .in("activity_id", ids)
          .eq("status", "checked_in")
      : Promise.resolve({ data: [] as { id: string; activity_id: string; role: string }[] }),
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

    /*
     * Check-in dalillari. Joylashuv XULOSASI olinadi — aniq
     * koordinata adminga ham kerak emas va u brauzergacha
     * yetib bormasligi kerak (§8, §36).
     */
    ids.length
      ? db
          .from("mehr_checkins")
          .select("participant_id, location_verified, mehr_participants!inner(activity_id)")
          .in("mehr_participants.activity_id", ids)
      : Promise.resolve({ data: [] as unknown[] }),

    ids.length
      ? db.from("mehr_activity_sessions").select("activity_id").in("activity_id", ids)
      : Promise.resolve({ data: [] as { activity_id: string }[] }),

    db.from("point_rules").select("code, points").in("code", [
      "mehr.participant",
      "mehr.co_organizer",
      "mehr.organizer",
    ]).eq("is_active", true),
  ]);

  const countBy = (list: { activity_id: string }[] | null) => {
    const map = new Map<string, number>();
    for (const r of list ?? []) map.set(r.activity_id, (map.get(r.activity_id) ?? 0) + 1);
    return map;
  };

  const participantRows = (participantsRes.data ?? []) as {
    id: string;
    activity_id: string;
    role: string;
  }[];

  const participantCounts = countBy(participantRows);
  const mediaCounts = countBy(mediaRes.data as { activity_id: string }[] | null);
  const sessionCounts = countBy(sessionsRes.data as { activity_id: string }[] | null);

  /* Rol bo'yicha taqsimot — taklif etilayotgan ballni hisoblash uchun. */
  const rolesByActivity = new Map<string, Map<string, number>>();
  for (const p of participantRows) {
    const roles = rolesByActivity.get(p.activity_id) ?? new Map<string, number>();
    roles.set(p.role, (roles.get(p.role) ?? 0) + 1);
    rolesByActivity.set(p.activity_id, roles);
  }

  const pointsByRole = new Map<string, number>();
  for (const r of (rulesRes.data ?? []) as { code: string; points: number }[]) {
    const role = r.code.replace("mehr.", "");
    pointsByRole.set(role === "participant" ? "participant" : role, Number(r.points));
  }

  /* Check-in xulosasi: nechta qayd, nechtasining joyi tasdiqlangan. */
  const participantActivity = new Map(participantRows.map((p) => [p.id, p.activity_id]));
  const checkinCounts = new Map<string, number>();
  const locationVerified = new Map<string, number>();

  for (const c of (checkinsRes.data ?? []) as {
    participant_id: string;
    location_verified: boolean | null;
  }[]) {
    const activityId = participantActivity.get(c.participant_id);
    if (!activityId) continue;
    checkinCounts.set(activityId, (checkinCounts.get(activityId) ?? 0) + 1);
    if (c.location_verified === true) {
      locationVerified.set(activityId, (locationVerified.get(activityId) ?? 0) + 1);
    }
  }

  const history = new Map<string, { approved: number; rejected: number }>();
  for (const r of (historyRes.data ?? []) as { organizer_profile_id: string; status: string }[]) {
    const entry = history.get(r.organizer_profile_id) ?? { approved: 0, rejected: 0 };
    if (r.status === "approved") entry.approved += 1;
    else entry.rejected += 1;
    history.set(r.organizer_profile_id, entry);
  }

  const queue: ReviewQueueItem[] = rows.map((row) => {
    const hist = history.get(row.organizer_profile_id) ?? { approved: 0, rejected: 0 };

    const roles = rolesByActivity.get(row.id) ?? new Map<string, number>();
    const breakdown = [...roles.entries()].map(([role, count]) => ({
      role,
      count,
      points: (pointsByRole.get(role) ?? 0) * count,
    }));

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

      checkinCount: checkinCounts.get(row.id) ?? 0,
      locationVerifiedCount: locationVerified.get(row.id) ?? 0,
      requiresLocation: row.requires_location === true,
      hadSession: (sessionCounts.get(row.id) ?? 0) > 0,

      proposedPoints: breakdown.reduce((sum, b) => sum + b.points, 0),
      proposedBreakdown: breakdown,
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
