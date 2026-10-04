"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { approveEdit, rejectEdit, type ReviewResult } from "@/lib/profile-editor/review-service";
import {
  approveEntry,
  rejectEntry,
  type EntryReviewResult,
} from "@/lib/profile-editor/entry-review-service";
import {
  setCertificateTrust,
  type CertificateReviewResult,
} from "@/lib/profile-editor/certificate-review-service";
import {
  approveSection,
  rejectSection,
  type SectionReviewResult,
} from "@/lib/profile-editor/section-review-service";

/**
 * PROFIL TAHRIRLARINI KO'RISH AMALLARI.
 *
 * Ikkisi ham `candidates.edit` ruxsatini TALAB qiladi va u serverda
 * tekshiriladi: panelda tugmani yashirish avtorizatsiya emas, chunki
 * server amali to'g'ridan-to'g'ri chaqirilishi mumkin.
 *
 * KO'RUVCHI BRAUZERDAN OLINMAYDI — `requirePermission` qaytargan
 * kontekstdan olinadi. Aks holda admin boshqa odamning nomidan
 * tasdiqlab qo'yardi (§44).
 */

export async function approveProfileEdit(
  editId: string,
  note: string,
): Promise<ReviewResult> {
  const ctx = await requirePermission("candidates.edit");

  if (!isUuid(editId)) return { ok: false, error: "O'zgarish tanlanmagan." };

  const result = await approveEdit(editId, ctx.userId, note);
  if (result.ok) revalidatePath("/profil-tahrirlari");
  return result;
}

export async function rejectProfileEdit(
  editId: string,
  note: string,
): Promise<ReviewResult> {
  const ctx = await requirePermission("candidates.edit");

  if (!isUuid(editId)) return { ok: false, error: "O'zgarish tanlanmagan." };

  const result = await rejectEdit(editId, ctx.userId, note);
  if (result.ok) revalidatePath("/profil-tahrirlari");
  return result;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/* ========================================================================= *
 * TUZILGAN YOZUVLAR
 *
 *    `candidates` ustunlaridan ALOHIDA amallar: u yerda eski/yangi
 *    qiymat juftligi tasdiqlanadi, bu yerda esa qatorning o'zi.
 * ========================================================================= */

export async function approveEntryAction(
  kind: string,
  entryId: string,
  note: string,
): Promise<EntryReviewResult> {
  const ctx = await requirePermission("candidates.edit");

  if (!isUuid(entryId)) return { ok: false, error: "Yozuv tanlanmagan." };

  const result = await approveEntry(kind, entryId, ctx.userId, note);
  if (result.ok) revalidatePath("/profil-tahrirlari");
  return result;
}

export async function rejectEntryAction(
  kind: string,
  entryId: string,
  note: string,
): Promise<EntryReviewResult> {
  const ctx = await requirePermission("candidates.edit");

  if (!isUuid(entryId)) return { ok: false, error: "Yozuv tanlanmagan." };

  const result = await rejectEntry(kind, entryId, ctx.userId, note);
  if (result.ok) revalidatePath("/profil-tahrirlari");
  return result;
}

/* ========================================================================= *
 * BIOGRAFIYA BO'LIMLARI
 *
 *    Ko'rilayotgan narsa — ommaviy biografiyadagi MATNNING O'ZI.
 *    Tasdiqlangandan keyin u darhol sahifada ko'rinadi.
 * ========================================================================= */

export async function approveSectionAction(
  sectionId: string,
  note: string,
): Promise<SectionReviewResult> {
  const ctx = await requirePermission("candidates.edit");

  if (!isUuid(sectionId)) return { ok: false, error: "Bo'lim tanlanmagan." };

  const result = await approveSection(sectionId, ctx.userId, note);
  if (result.ok) revalidatePath("/profil-tahrirlari");
  return result;
}

export async function rejectSectionAction(
  sectionId: string,
  note: string,
): Promise<SectionReviewResult> {
  const ctx = await requirePermission("candidates.edit");

  if (!isUuid(sectionId)) return { ok: false, error: "Bo'lim tanlanmagan." };

  const result = await rejectSection(sectionId, ctx.userId, note);
  if (result.ok) revalidatePath("/profil-tahrirlari");
  return result;
}

/* ========================================================================= *
 * SERTIFIKATLAR
 *
 *    Admin uch darajadan birini tanlaydi. `pending_review` ga qaytarib
 *    bo'lmaydi — u boshlang'ich holat, qaror emas.
 * ========================================================================= */

export async function setCertificateTrustAction(
  certificateId: string,
  choice: string,
  note: string,
): Promise<CertificateReviewResult> {
  const ctx = await requirePermission("candidates.edit");

  if (!isUuid(certificateId)) return { ok: false, error: "Sertifikat tanlanmagan." };

  const result = await setCertificateTrust(certificateId, choice, ctx.userId, note);
  if (result.ok) revalidatePath("/profil-tahrirlari");
  return result;
}
