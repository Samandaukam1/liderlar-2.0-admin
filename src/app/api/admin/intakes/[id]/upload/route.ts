import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { getIntakeSettings } from "@/lib/intake/data";
import { uploadIntakeFile } from "@/lib/intake/attachments";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** POST /api/admin/intakes/[id]/upload — admin-side portrait/attachment upload. */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await checkPermission("intakes.edit");
  if (!admin) return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });
  const { id: intakeId } = await ctx.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Fayl yuborilmadi" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Fayl topilmadi" }, { status: 400 });

  const purpose = form.get("purpose") === "photo" ? "photo" : "attachment";
  const questionNoRaw = form.get("question_no");
  const questionNo = questionNoRaw != null ? Number(questionNoRaw) : null;

  const settings = await getIntakeSettings();
  const bytes = new Uint8Array(await file.arrayBuffer());

  const outcome = await uploadIntakeFile({
    intakeId,
    bytes,
    declaredMime: file.type,
    originalName: file.name,
    purpose,
    questionNo,
    maxBytes: settings.maxUploadBytes,
    uploadedBy: admin.userId,
  });

  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status ?? 400 });

  await logAudit({
    actorId: admin.userId,
    action: "intake.upload",
    entityType: "candidate_intake",
    entityId: intakeId,
    metadata: { purpose, kind: outcome.attachment.kind },
  });

  return NextResponse.json({ ok: true, attachment: outcome.attachment });
}
