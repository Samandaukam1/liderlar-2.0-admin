import { NextResponse } from "next/server";
import { z } from "zod";
import { checkPermission } from "@/lib/auth";
import { improveText } from "@/lib/ai";

const bodySchema = z.object({
  text: z.string().min(20, "Matn juda qisqa").max(24000, "Matn juda uzun"),
  candidateName: z.string().max(200).optional(),
  context: z.string().max(500).optional(),
  entityType: z.enum(["monthly_update", "article", "playground"]),
  entityId: z.string().uuid().nullish(),
});

export async function POST(request: Request) {
  const ctx = await checkPermission("ai.use");
  if (!ctx) {
    return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON xato" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "So‘rov noto‘g‘ri" },
      { status: 400 },
    );
  }

  try {
    const result = await improveText({
      text: parsed.data.text,
      candidateName: parsed.data.candidateName,
      context: parsed.data.context,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId ?? null,
      actorId: ctx.userId,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("AI improve failed", err);
    return NextResponse.json(
      { error: "Jaxongir AI hozircha javob bera olmadi. Birozdan so‘ng qayta urinib ko‘ring." },
      { status: 502 },
    );
  }
}
