"use server";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseTashkentDateTime, tashkentDayRange, tashkentToday } from "@/lib/tashkent-day";
import type { Application } from "@/lib/types";
import { formatNewApplications, telegramUsername } from "./new-applications-txt";

const PAGE_SIZE = 500;
const EXPORT_REVIEW_REASON = "Yangi arizalar eksporti";
const timestamp = z.iso.datetime({ offset: true });
const cursorSchema = z.object({ id: z.uuid(), created_at: timestamp });
const reportBoundarySchema = cursorSchema.extend({
  full_name: z.string(),
  status: z.literal("in_review"),
});
const count = z.number().int().nonnegative().max(2_147_483_647);
const exportContextSchema = z.object({
  boundary: cursorSchema.nullable(),
  last_export_id: z.uuid().nullable(),
  username_count: count,
  phone_count: count,
});
const receiptSchema = z.object({
  exportId: z.uuid(),
  previousExportId: z.uuid().nullable(),
  date: z.iso.date(),
  boundaryId: z.uuid().nullable(),
  usernameCount: count,
  phoneCount: count,
  latest: cursorSchema.extend({ updated_at: timestamp }),
});
const signedReceiptSchema = receiptSchema.extend({ signature: z.hex().length(64) });

type Cursor = z.infer<typeof cursorSchema>;
type ExportReceipt = z.infer<typeof receiptSchema>;
type ExportRow = Pick<Application, "id" | "full_name" | "telegram" | "phone" | "created_at" | "updated_at">;
type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Bitta so‘rovda eksport chegarasi va shu sananing hisoblagichlarini oladi. */
async function loadExportContext(admin: Admin, until: string) {
  const { data, error } = await admin.rpc("get_application_export_context", { p_until: until });
  if (error) throw error;
  return exportContextSchema.parse(data);
}

function following(cursor: Cursor): string {
  return `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`;
}

function signReceipt(receipt: ExportReceipt, actorId: string): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing application export signing key");
  return createHmac("sha256", secret)
    .update(JSON.stringify(["applications-export:v2", actorId, receipt]))
    .digest();
}

/** Yangi arizalarni o‘qiydi va raqamlangan faylni imzolangan kvitansiya bilan tayyorlaydi. */
export async function prepareNewApplicationsExport(startAt?: string) {
  const ctx = await requirePermission("applications.review");
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const until = now.toISOString();

  try {
    const context = await loadExportContext(admin, until);
    const { boundary } = context;
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

    const { text, usernameCount, phoneCount } = formatNewApplications(rows, {
      usernameCount: context.username_count,
      phoneCount: context.phone_count,
    });
    const receipt = receiptSchema.parse({
      exportId: randomUUID(),
      previousExportId: context.last_export_id,
      date: tashkentToday(now),
      boundaryId: boundary?.id ?? null,
      usernameCount,
      phoneCount,
      latest: last,
    });
    return {
      status: "ready",
      filename: `yangi-arizalar-${receipt.date}.txt`,
      text,
      count: rows.length,
      receipt: { ...receipt, signature: signReceipt(receipt, ctx.userId).toString("hex") },
    } as const;
  } catch (error) {
    console.error("Yangi arizalar eksporti tayyorlanmadi", error);
    return { status: "error", message: "Faylni tayyorlab bo‘lmadi. Qayta urinib ko‘ring." } as const;
  }
}

/** Kvitansiyani tekshiradi va hisoblagichlar bilan statusni atomar ravishda saqlaydi. */
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
    const { data, error } = await admin.rpc("complete_application_export", {
      p_export_id: receipt.exportId,
      p_previous_export_id: receipt.previousExportId,
      p_export_date: receipt.date,
      p_boundary_id: receipt.boundaryId,
      p_latest_id: receipt.latest.id,
      p_latest_updated_at: receipt.latest.updated_at,
      p_username_count: receipt.usernameCount,
      p_phone_count: receipt.phoneCount,
      p_actor_id: ctx.userId,
    });
    if (error) throw error;
    if (data === "superseded") {
      return { status: "superseded" } as const;
    }
    if (data !== "saved" && data !== "already_saved") throw new Error("Unknown application export result");

    if (data === "saved") {
      await logAudit({
        actorId: ctx.userId,
        action: "application.in_review",
        entityType: "application",
        entityId: receipt.latest.id,
        oldValue: { status: "new" },
        newValue: { status: "in_review" },
        reason: EXPORT_REVIEW_REASON,
      });
    }
    revalidatePath("/applications");
    revalidatePath(`/applications/${receipt.latest.id}`);
    return { status: "saved" } as const;
  } catch (error) {
    console.error("Yangi arizalar eksportini qayd etib bo‘lmadi", error);
    return { status: "error" } as const;
  }
}

async function latestReceivedInReview(admin: Admin, from: string, before: string) {
  const { data, error } = await admin.from("applications")
    .select("id, created_at, full_name, status")
    .eq("status", "in_review")
    .gte("created_at", from)
    .lt("created_at", before)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? reportBoundarySchema.parse(data) : null;
}

export async function getDailyApplicationsReport() {
  await requirePermission("applications.view");
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const day = tashkentDayRange(now);
  const yesterday = tashkentDayRange(new Date(Date.parse(day.startIso) - 1));

  try {
    const [start, end] = await Promise.all([
      latestReceivedInReview(admin, yesterday.startIso, day.startIso),
      latestReceivedInReview(admin, day.startIso, now.toISOString()),
    ]);
    if (!end) return { status: "no_today_review" } as const;
    if (!start) return { status: "no_yesterday_review" } as const;

    let total = 0;
    let withUsername = 0;
    let cursor: Cursor = start;
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

    return {
      status: "ready",
      date: day.date,
      total,
      withUsername,
      start: { name: start.full_name, receivedAt: start.created_at, status: start.status },
      end: { name: end.full_name, receivedAt: end.created_at, status: end.status },
    } as const;
  } catch (error) {
    console.error("Kunlik arizalar hisoboti tayyorlanmadi", error);
    return { status: "error" } as const;
  }
}
