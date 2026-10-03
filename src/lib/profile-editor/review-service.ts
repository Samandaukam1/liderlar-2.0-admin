import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";
import { loadAuditActors } from "@/lib/audit-actors";

/**
 * PROFIL TAHRIRLARI — ADMIN KO'RIGI.
 *
 * Foydalanuvchi yuborgan va ko'rik talab qiladigan o'zgarishlar
 * navbati. Darhol nashr bo'ladigan maydonlar bu yerga TUSHMAYDI —
 * ular to'g'ridan-to'g'ri `candidates` ga yozilgan.
 *
 * TASDIQLASH RPC ORQALI: `candidates` yangilanishi va navbat
 * yozuvining yopilishi bitta tranzaksiyada bo'lishi kerak. Ikki
 * alohida so'rov bo'lsa, biri o'tib ikkinchisi yiqilganda navbat
 * adminga qayta ko'rsatilardi yoki o'zgarish auditsiz qolardi.
 */

/**
 * Maydonlarning odam tilidagi nomlari.
 *
 * Web repodagi `CANDIDATE_FIELDS` bilan bir xil bo'lishi kerak, lekin
 * admin repo undan import qila olmaydi: ikki alohida deploy va umumiy
 * paket yo'q. Nomuvofiqlik xavfi kichik — eng yomoni admin texnik nom
 * ko'radi, ma'lumot buzilmaydi.
 */
const FIELD_LABEL: Readonly<Record<string, string>> = {
  short_bio: "Qisqa ma'lumot",
  birth_date: "Tug'ilgan sana",
  region_id: "Hudud",
  category_id: "Yo'nalish",
  phone: "Telefon",
  email: "Email",
};

export interface PendingEditRow {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateSlug: string;
  field: string;
  fieldLabel: string;
  beforeValue: string | null;
  afterValue: string | null;
  /** Yuborgan odamning ismi. */
  submittedBy: string;
  createdAt: string;
}

/**
 * Ko'rik kutayotgan o'zgarishlar.
 *
 * ENG ESKI BIRINCHI: navbat tartibi odamlar kutgan vaqtga qarab
 * bo'lishi kerak, aks holda eski so'rovlar pastda qolib ketardi.
 */
export async function loadPendingEdits(limit = 200): Promise<PendingEditRow[]> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("candidate_profile_edits")
    /*
     * BITTA LITERAL QATOR, birlashtirilgan EMAS.
     *
     * Supabase tiplari `select` ni faqat literal bo'lsa o'qiydi;
     * `"a" + "b"` bo'lsa natija `GenericStringError` bo'lib chiqadi
     * va tip tekshiruvi butunlay yo'qoladi.
     */
    .select(
      "id, candidate_id, field, before_value, after_value, created_at, candidates(full_name, slug), profiles(full_name)",
    )
    .eq("state", "pending_review")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[profil-korik] navbat o'qilmadi:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const candidate = row.candidates as { full_name?: string; slug?: string } | null;
    const submitter = row.profiles as { full_name?: string } | null;
    const field = row.field as string;

    return {
      id: row.id as string,
      candidateId: row.candidate_id as string,
      candidateName: candidate?.full_name?.trim() || "(nomsiz)",
      candidateSlug: candidate?.slug ?? "",
      field,
      fieldLabel: FIELD_LABEL[field] ?? field,
      beforeValue: (row.before_value as string | null) ?? null,
      afterValue: (row.after_value as string | null) ?? null,
      submittedBy: submitter?.full_name?.trim() || "(ism yo'q)",
      createdAt: row.created_at as string,
    };
  });
}

export type ReviewResult = { ok: true } | { ok: false; error: string };

/**
 * O'zgarishni tasdiqlaydi va `candidates` ga yozadi.
 *
 * Qaysi ustunga yozilishi SQL funksiyasida qat'iy sanab chiqilgan:
 * `field` erkin matn va uni dinamik SQL'da ustun nomi sifatida
 * ishlatish in'ektsiyaga yo'l ochardi.
 */
export async function approveEdit(
  editId: string,
  reviewerId: string,
  note: string | null,
): Promise<ReviewResult> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .rpc("apply_candidate_profile_edit", {
      p_edit_id: editId,
      p_reviewer_id: reviewerId,
      p_note: note?.trim() || null,
    })
    .single();

  if (!error && data) {
    /*
     * Funksiya qo'llangan qatorni qaytaradi — jurnalga ESKI va YANGI
     * qiymat shundan yoziladi (brauzerdan emas).
     */
    const edit = data as {
      candidate_id: string;
      field: string;
      before_value: string | null;
      after_value: string | null;
    };
    await recordAudit("profile.edit.approved", {
      actorId: reviewerId,
      entityId: edit.candidate_id,
      reason: note?.trim() || null,
      before: { [edit.field]: edit.before_value },
      after: { [edit.field]: edit.after_value },
      metadata: { edit_id: editId, field: edit.field },
    });
    return { ok: true };
  }

  if (!error) {
    console.error("[profil-korik] tasdiq natijasi bo'sh qaytdi:", { editId });
    return { ok: false, error: "O'zgarishni qo'llab bo'lmadi." };
  }

  /*
   * POYGA — TUSHUNARLI MATN BILAN.
   *
   * Ikki admin bir vaqtda tasdiqlasa, ikkinchisi SQL'dagi holat
   * tekshiruviga uriladi (`PT409`). "Qayta yuklang" degan xabar bu
   * holatda to'g'ri: admin boshqa adminning qarorini ko'radi.
   * `40001` eski funksiya versiyasi uchun qoldirilgan.
   */
  if (
    error.code === "PT409" ||
    error.code === "40001" ||
    /allaqachon ko'rildi|allaqachon ko‘rildi/.test(error.message)
  ) {
    return {
      ok: false,
      error: "Bu o'zgarish allaqachon ko'rib chiqilgan. Sahifani yangilang.",
    };
  }

  /*
   * Maydon SQL'da qo'llanmaydigan bo'lsa, buni ALOHIDA aytamiz:
   * bu sozlash xatosi va umumiy "saqlanmadi" matni uni yashirardi.
   */
  if (error.code === "22023" || /qo'llanmaydi|qo‘llanmaydi/.test(error.message)) {
    console.error("[profil-korik] maydon SQL da qo'llanmagan:", error.message);
    return {
      ok: false,
      error: "Bu maydonni tasdiqlash hali sozlanmagan. Dasturchiga xabar bering.",
    };
  }

  console.error("[profil-korik] tasdiqlanmadi:", error.message);
  return { ok: false, error: "O'zgarishni qo'llab bo'lmadi." };
}

/**
 * O'zgarishni qaytaradi.
 *
 * `candidates` ga TEGMAYDI — faqat navbat yozuvi yopiladi. Shuning
 * uchun RPC kerak emas: bitta jadvalga bitta yozuv.
 *
 * SABAB MAJBURIY: foydalanuvchi nima uchun qaytarilganini bilishi
 * kerak (§27 — "User sees editorial feedback"). Sababsiz rad etish
 * odamni qorong'uda qoldirardi.
 */
export async function rejectEdit(
  editId: string,
  reviewerId: string,
  note: string,
): Promise<ReviewResult> {
  const reason = note.trim();
  if (reason.length < 3) {
    return { ok: false, error: "Qaytarish sababini yozing (kamida 3 belgi)." };
  }

  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("candidate_profile_edits")
    .update({
      state: "rejected",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_note: reason,
    })
    .eq("id", editId)
    /*
     * HOLAT SHARTI: faqat kutayotganini qaytarish mumkin.
     *
     * Bo'lmasa, allaqachon qo'llangan o'zgarish "qaytarilgan" deb
     * belgilanib, `candidates` dagi qiymat esa joyida qolardi —
     * ya'ni navbat haqiqatga zid holatga tushardi.
     */
    .eq("state", "pending_review")
    .select("id, candidate_id, field, before_value, after_value")
    .maybeSingle();

  if (error) {
    console.error("[profil-korik] qaytarilmadi:", error.message);
    return { ok: false, error: "O'zgarishni qaytarib bo'lmadi." };
  }
  if (!data) {
    return {
      ok: false,
      error: "Bu o'zgarish allaqachon ko'rib chiqilgan. Sahifani yangilang.",
    };
  }

  const field = data.field as string;
  await recordAudit("profile.edit.rejected", {
    actorId: reviewerId,
    entityId: data.candidate_id as string,
    reason,
    // Qaytarilgan qiymat profilga tushmagan — `after` emas, metadata'da.
    metadata: {
      edit_id: editId,
      field,
      proposed_value: (data.after_value as string | null) ?? null,
    },
  });

  return { ok: true };
}

/* ========================================================================= *
 * TARIX
 * ========================================================================= */

export interface EditHistoryRow {
  id: string;
  field: string;
  fieldLabel: string;
  beforeValue: string | null;
  afterValue: string | null;
  state: string;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** Yuborgan a'zo. */
  submittedBy: string;
  /** Ko'rib chiqqan xodim; hali ko'rilmagan bo'lsa `null`. */
  reviewedBy: string | null;
}

export type EditHistoryResult =
  | { ok: true; rows: EditHistoryRow[] }
  | { ok: false; error: string };

/**
 * Bitta nomzodning tahrir tarixi (§6 revision history).
 *
 * Yopilgan yozuvlar O'CHIRILMAYDI, shuning uchun tarix shu
 * jadvalning o'zidan o'qiladi.
 *
 * XATO SAHIFANI YIQITMAYDI: natija `ok: false` bilan qaytadi va nomzod
 * sahifasi faqat shu bo'limda xabar ko'rsatadi. Oldin `throw` butun
 * sahifani xato ekraniga almashtirardi.
 */
export async function loadEditHistory(
  candidateId: string,
  limit = 50,
): Promise<EditHistoryResult> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("candidate_profile_edits")
    .select(
      "id, field, before_value, after_value, state, review_note, created_at, reviewed_at, profile_id, reviewed_by",
    )
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[profil-korik] tarix o'qilmadi:", error.message);
    return { ok: false, error: "Tahrir tarixini o‘qib bo‘lmadi." };
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  /*
   * `reviewed_by` auth.users ga bog'langan — `profiles(...)` bilan qo'shib
   * bo'lmaydi. Ikkala ism ham bitta umumiy o'qish bilan olinadi.
   */
  const people = await loadAuditActors(
    rows.flatMap((row) => [
      { actor_id: (row.profile_id as string | null) ?? null },
      { actor_id: (row.reviewed_by as string | null) ?? null },
    ]),
  );

  return {
    ok: true,
    rows: rows.map((row) => {
      const field = row.field as string;
      const reviewer = (row.reviewed_by as string | null) ?? null;
      return {
        id: row.id as string,
        field,
        fieldLabel: FIELD_LABEL[field] ?? field,
        beforeValue: (row.before_value as string | null) ?? null,
        afterValue: (row.after_value as string | null) ?? null,
        state: row.state as string,
        reviewNote: (row.review_note as string | null) ?? null,
        createdAt: row.created_at as string,
        reviewedAt: (row.reviewed_at as string | null) ?? null,
        submittedBy: people.actorOf((row.profile_id as string | null) ?? null).name,
        reviewedBy: reviewer ? people.actorOf(reviewer).name : null,
      };
    }),
  };
}
