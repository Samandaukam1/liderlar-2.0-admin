"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { slugify } from "@/lib/utils";
import { candidateEditorPayloadSchema, candidateStructuredSchema, type CandidateStructuredData } from "@/lib/candidates/schema";
import { serializeCandidateData } from "@/lib/candidates/serializer";
import { structureCandidateWithAi } from "@/lib/candidates/ai-service";
import {
  saveCandidateProfile,
  saveCandidatePrompt,
  updateCandidateAiMetadata,
} from "@/lib/candidates/repository";
import { DEFAULT_CANDIDATE_AI_PROMPT } from "@/lib/candidates/prompt";

export interface CandidateEditorActionResult {
  ok: boolean;
  error?: string;
  candidateId?: string;
  slug?: string;
  data?: CandidateStructuredData;
}

export async function saveCandidateEditorAction(input: unknown): Promise<CandidateEditorActionResult> {
  const parsed = candidateEditorPayloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  const ctx = await requirePermission(parsed.data.candidateId ? "candidates.edit" : "candidates.create");
  const data = parsed.data;
  data.slug = data.slug || slugify(data.fullName);
  data.descriptionItems = [...new Set(data.descriptionItems.map((item) => item.trim()).filter(Boolean))];
  data.languages = [...new Set(data.languages.map((item) => item.trim()).filter(Boolean))];
  data.sections = data.sections.map((section, order) => ({ ...section, title: section.title.trim(), content: section.content.trim(), order }));
  data.formattedContent = serializeCandidateData(data);
  try {
    const saved = await saveCandidateProfile(data, ctx.userId);
    revalidatePath("/candidates");
    revalidatePath(`/candidates/${saved.candidateId}`);
    return { ok: true, candidateId: saved.candidateId, slug: saved.slug };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Nomzodni saqlab bo‘lmadi" };
  }
}

const aiRequestSchema = z.object({
  candidateId: z.string().uuid().nullable(),
  rawText: z.string().trim().min(10, "AI uchun matn juda qisqa").max(200_000),
  current: candidateStructuredSchema,
});

export async function structureCandidateWithAiAction(input: unknown): Promise<CandidateEditorActionResult> {
  const parsed = aiRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "AI so‘rovi noto‘g‘ri" };
  const ctx = await requirePermission(parsed.data.candidateId ? "candidates.edit" : "candidates.create");
  if (parsed.data.candidateId) {
    await updateCandidateAiMetadata(parsed.data.candidateId, { status: "processing" });
  }
  try {
    const result = await structureCandidateWithAi({
      rawText: parsed.data.rawText,
      current: parsed.data.current,
      actorId: ctx.userId,
      candidateId: parsed.data.candidateId,
    });
    const data: CandidateStructuredData = {
      ...parsed.data.current,
      fullName: result.data.fullName,
      descriptionItems: result.data.description,
      birthYear: result.data.birthYear,
      birthPlace: result.data.birthPlace,
      currentLocation: result.data.currentLocation,
      education: result.data.education,
      activityField: result.data.activityField,
      languages: result.data.languages,
      sections: result.data.sections.map((section, order) => ({ ...section, id: crypto.randomUUID(), order })),
      rawContent: parsed.data.rawText,
      unparsedContent: "",
      formattedContent: "",
    };
    data.formattedContent = serializeCandidateData(data);
    if (parsed.data.candidateId) {
      await updateCandidateAiMetadata(parsed.data.candidateId, {
        status: "succeeded",
        model: result.model,
        rawResponse: result.rawResponse,
      });
    }
    return { ok: true, data };
  } catch (error) {
    if (parsed.data.candidateId) {
      await updateCandidateAiMetadata(parsed.data.candidateId, { status: "failed" }).catch(() => undefined);
    }
    return { ok: false, error: error instanceof Error ? error.message : "Jaxongir AI javob bermadi" };
  }
}

export async function saveCandidatePromptAction(value: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermission("candidates.edit");
  const parsed = z.string().trim().min(100).max(30_000).safeParse(value);
  if (!parsed.success) return { ok: false, error: "Prompt 100–30 000 belgi oralig‘ida bo‘lishi kerak" };
  try {
    await saveCandidatePrompt(parsed.data, ctx.userId);
    revalidatePath("/candidates");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Promptni saqlab bo‘lmadi" };
  }
}

export async function resetCandidatePromptAction(): Promise<{ ok: boolean; error?: string; value?: string }> {
  const result = await saveCandidatePromptAction(DEFAULT_CANDIDATE_AI_PROMPT);
  return { ...result, value: result.ok ? DEFAULT_CANDIDATE_AI_PROMPT : undefined };
}

