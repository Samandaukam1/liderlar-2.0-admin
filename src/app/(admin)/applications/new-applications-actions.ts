"use server";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseTashkentDateTime, tashkentDayRange } from "@/lib/tashkent-day";
import type { Application } from "@/lib/types";
import { formatNewApplications, telegramUsername } from "./new-applications-txt";

const PAGE_SIZE = 500;
const EXPORT_REVIEW_REASON = "Yangi arizalar eksporti";
const timestamp = z.iso.datetime({ offset: true });
const cursorSchema = z.object({ id: z.uuid(), created_at: timestamp });
const receiptSchema = z.object({
  boundaryId: z.uuid().nullable(),
  latest: cursorSchema.extend({ updated_at: timestamp }),
});
const signedReceiptSchema = receiptSchema.extend({ signature: z.hex().length(64) });

type Cursor = z.infer<typeof cursorSchema>;
type ExportReceipt = z.infer<typeof receiptSchema>;
type ExportRow = Pick<Application, "id" | "full_name" | "telegram" | "phone" | "created_at" | "updated_at">;
type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function latestInReview(admin: Admin, until: string) {
  const { data, error } = await admin.from("applications")
    .select("id, created_at")
    .eq("status", "in_review")
    .lte("created_at", until)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? cursorSchema.parse(data) : null;
}

function following(cursor: Cursor): string {
  return `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`;
}

function signReceipt(receipt: ExportReceipt, actorId: string): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing application export signing key");
  return createHmac("sha256", secret)
    .update(JSON.stringify(["applications-export:v1", actorId, receipt]))
    .digest();
}

export async function prepareNewApplicationsExport(startAt?: string) {
  const ctx = await requirePermission("applications.review");
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const until = now.toISOString();

  try {
    const boundary = await latestInReview(admin, until);
    let cursor = boundary;

    const since = typeof startAt === "string" ? parseTashkentDateTime(startAt) : null;
    if (!cursor && (!since || since > until)) {
      return { status: "start_required" } as const;
    }

    const rows: ExportRow[] = [];
    while (true) {
      let query = admin.from("applications")
        .select("id, full_name, telegram, phone, created_at, updated_at")
        .eq("status", "new")
        .lte("created_at", until)
        .order("created_at")
        .order("id")
        .limit(PAGE_SIZE);
      if (cursor) query = query.or(following(cursor));
      else if (since) query = query.gte("created_at", since);

      const { data, error } = await query;
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
      cursor = cursorSchema.parse(data.at(-1));
    }

    const last = rows.at(-1);
    if (!last) return { status: "empty" } as const;

    const receipt = receiptSchema.parse({ boundaryId: boundary?.id ?? null, latest: last });
    return {
      status: "ready",
      filename: `yangi-arizalar-${tashkentDayRange(now).date}.txt`,
      text: formatNewApplications(rows),
      count: rows.length,
      receipt: { ...receipt, signature: signReceipt(receipt, ctx.userId).toString("hex") },
    } as const;
  } catch (error) {
    console.error("Yangi arizalar eksporti tayyorlanmadi", error);
    return { status: "error", message: "Faylni tayyorlab bo‘lmadi. Qayta urinib ko‘ring." } as const;
  }
}

export async function completeNewApplicationsExport(input: z.infer<typeof signedReceiptSchema>) {
  const ctx = await requirePermission("applications.review");
  const parsed = signedReceiptSchema.safeParse(input);
  if (!parsed.success) return { status: "error" } as const;

  const { signature, ...receipt } = parsed.data;
  const admin = createSupabaseAdminClient();
  try {
    if (!timingSafeEqual(Buffer.from(signature, "hex"), signReceipt(receipt, ctx.userId))) {
      return { status: "error" } as const;
    }
    const boundary = await latestInReview(admin, new Date().toISOString());
    if (boundary?.id === receipt.latest.id) return { status: "saved" } as const;
    if ((boundary?.id ?? null) !== receipt.boundaryId) {
      return { status: "superseded" } as const;
    }

    // Update only the exported end of the batch and preserve any concurrent edit.
    const { data, error } = await admin.from("applications")
      .update({ status: "in_review", assignee_id: ctx.userId })
      .eq("id", receipt.latest.id)
      .eq("status", "new")
      .eq("updated_at", receipt.latest.updated_at)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { status: "superseded" } as const;

    await logAudit({
      actorId: ctx.userId,
      action: "application.in_review",
      entityType: "application",
      entityId: receipt.latest.id,
      oldValue: { status: "new" },
      newValue: { status: "in_review" },
      reason: EXPORT_REVIEW_REASON,
    });
    revalidatePath("/applications");
    revalidatePath(`/applications/${receipt.latest.id}`);
    return { status: "saved" } as const;
  } catch (error) {
    console.error("Yangi arizalar eksportini qayd etib bo‘lmadi", error);
    return { status: "error" } as const;
  }
}

async function latestReviewEvent(admin: Admin, before: string, from?: string, exportOnly = true) {
  let query = admin.from("audit_logs")
    .select("entity_id")
    .eq("entity_type", "application")
    .eq("action", "application.in_review")
    .lt("created_at", before);
  if (from) query = query.gte("created_at", from);
  if (exportOnly) query = query.eq("reason", EXPORT_REVIEW_REASON);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? z.uuid().parse(data.entity_id) : null;
}

export async function getDailyApplicationsReport() {
  await requirePermission("applications.view");
  const admin = createSupabaseAdminClient();
  const day = tashkentDayRange();

  try {
    const [todayId, previousExportId] = await Promise.all([
      latestReviewEvent(admin, day.endIso, day.startIso),
      latestReviewEvent(admin, day.startIso),
    ]);
    if (!todayId) return { status: "no_export" } as const;

    // Before TXT exports existed, reviewers set the same status manually.
    const previousId = previousExportId ?? await latestReviewEvent(admin, day.startIso, undefined, false);
    if (!previousId) return { status: "no_boundary" } as const;

    const { data: boundaries, error: boundaryError } = await admin.from("applications")
      .select("id, created_at")
      .in("id", [previousId, todayId]);
    if (boundaryError) throw boundaryError;
    const bounds = z.array(cursorSchema).parse(boundaries);
    const start = bounds.find((row) => row.id === previousId);
    const end = bounds.find((row) => row.id === todayId);
    if (!start || !end) return { status: "no_boundary" } as const;

    let total = 0;
    let withUsername = 0;
    let cursor = start;
    const throughEnd = `created_at.lt.${end.created_at},and(created_at.eq.${end.created_at},id.lte.${end.id})`;

    while (true) {
      const { data, error } = await admin.from("applications")
        .select("id, created_at, telegram")
        .gte("created_at", cursor.created_at)
        .lte("created_at", end.created_at)
        .or(`and(or(${following(cursor)}),or(${throughEnd}))`)
        .order("created_at")
        .order("id")
        .limit(PAGE_SIZE);
      if (error) throw error;

      total += data.length;
      for (const row of data) {
        if (telegramUsername(row.telegram)) withUsername++;
      }
      if (data.length < PAGE_SIZE || data.at(-1)?.id === end.id) break;
      cursor = cursorSchema.parse(data.at(-1));
    }

    return { status: "ready", date: day.date, total, withUsername } as const;
  } catch (error) {
    console.error("Kunlik arizalar hisoboti tayyorlanmadi", error);
    return { status: "error" } as const;
  }
}
