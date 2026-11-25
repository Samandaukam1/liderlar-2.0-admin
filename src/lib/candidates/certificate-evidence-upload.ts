import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  EVIDENCE_BUCKET,
  validEvidenceMeta,
  validEvidencePath,
} from "@/lib/profile-editor/evidence-rules";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UPLOAD_WINDOW_MS = 2 * 60 * 60 * 1000;
const receiptSchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  mimeType: z.string(),
  size: z.number(),
  expiresAt: z.number(),
});
type Receipt = z.infer<typeof receiptSchema>;

function sign(body: string, actorId: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing certificate evidence signing key");
  return createHmac("sha256", secret).update(`admin-certificate-evidence:v1:${actorId}:${body}`).digest();
}

export function signCertificateEvidenceReceipt(input: Omit<Receipt, "expiresAt">, actorId: string) {
  const body = Buffer.from(JSON.stringify({ ...input, expiresAt: Date.now() + UPLOAD_WINDOW_MS })).toString("base64url");
  return `${body}.${sign(body, actorId).toString("hex")}`;
}

export function readCertificateEvidenceReceipt(receipt: string, actorId: string): Receipt | null {
  const match = /^([A-Za-z0-9_-]{1,1800})\.([0-9a-f]{64})$/.exec(receipt);
  if (!match) return null;
  const [, body, signature] = match;
  if (!timingSafeEqual(Buffer.from(signature, "hex"), sign(body, actorId))) return null;

  const parsed = receiptSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  if (!parsed.success || parsed.data.expiresAt <= Date.now()) return null;
  return validEvidenceMeta(parsed.data.mimeType, parsed.data.size) ? parsed.data : null;
}

export async function removeCertificateEvidenceObject(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  path: string,
  candidateId: string,
  certificateId: string,
) {
  if (!validEvidencePath(path, candidateId, certificateId)) return;
  try {
    const { error } = await admin.storage.from(EVIDENCE_BUCKET).remove([path]);
    if (error) console.error("[admin certificate evidence] cleanup failed:", error.message);
  } catch (error) {
    console.error("[admin certificate evidence] cleanup failed:", error);
  }
}
