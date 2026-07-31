"use client";
/* eslint-disable @next/next/no-img-element -- preview and freshly uploaded arbitrary URLs */

import { Reorder, useDragControls } from "framer-motion";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  Clipboard,
  Copy,
  Download,
  FileText,
  GripVertical,
  ImageIcon,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, FormField, Input, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
  resetCandidatePromptAction,
  saveCandidateEditorAction,
  saveCandidatePromptAction,
  structureCandidateWithAiAction,
} from "@/lib/actions/candidate-editor";
import { parseCandidateText, splitPipeValues, stripCandidateMarkers, type CandidateParseResult } from "@/lib/candidates/parser";
import { serializeCandidateData } from "@/lib/candidates/serializer";
import type { CandidateSection, CandidateStructuredData } from "@/lib/candidates/schema";
import { slugify } from "@/lib/utils";

type MobileTab = "fields" | "text" | "preview";
type SaveState = "idle" | "saving" | "saved" | "error";

function isBlank(value: string | string[] | CandidateSection[]): boolean {
  return Array.isArray(value) ? value.length === 0 : !value.trim();
}

function meaningfulDiffs(current: CandidateStructuredData, incoming: CandidateStructuredData): string[] {
  const labels: Array<[keyof CandidateStructuredData, string]> = [
    ["fullName", "Ism-familiya"],
    ["descriptionItems", "Qisqa tavsif"],
    ["birthYear", "Tug‘ilgan yili"],
    ["birthPlace", "Tug‘ilgan joyi"],
    ["currentLocation", "Yashash hududi"],
    ["education", "Ta’lim"],
    ["activityField", "Faoliyat sohasi"],
    ["languages", "Tillar"],
    ["sections", "Kengaytirilgan bo‘limlar"],
  ];
  return labels
    .filter(([key]) => JSON.stringify(current[key]) !== JSON.stringify(incoming[key]) && !isBlank(incoming[key] as string | string[] | CandidateSection[]))
    .map(([, label]) => label);
}

function mergeParsed(
  current: CandidateStructuredData,
  result: CandidateParseResult,
  mode: "replace" | "fill",
): CandidateStructuredData {
  const parsed = result.data;
  const pick = <T extends string | string[] | CandidateSection[]>(existing: T, incoming: T): T =>
    mode === "replace" || isBlank(existing) ? incoming : existing;
  const next: CandidateStructuredData = {
    ...current,
    fullName: pick(current.fullName, parsed.fullName),
    descriptionItems: pick(current.descriptionItems, parsed.descriptionItems),
    birthYear: pick(current.birthYear, parsed.birthYear),
    birthPlace: pick(current.birthPlace, parsed.birthPlace),
    currentLocation: pick(current.currentLocation, parsed.currentLocation),
    education: pick(current.education, parsed.education),
    activityField: pick(current.activityField, parsed.activityField),
    languages: pick(current.languages, parsed.languages),
    sections: pick(current.sections, parsed.sections).map((section, order) => ({ ...section, order })),
    rawContent: result.rawText,
    unparsedContent: [current.unparsedContent, result.unparsedText].filter(Boolean).join("\n\n"),
    formattedContent: "",
  };
  next.formattedContent = serializeCandidateData(next);
  return next;
}

function useDebouncedValue<T>(value: T, delay = 180): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export function CandidateEditor({
  candidateId,
  initialData,
  initialPrompt,
}: {
  candidateId: string | null;
  initialData: CandidateStructuredData;
  initialPrompt: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState(initialData);
  const [rawText, setRawText] = useState(initialData.rawContent || initialData.formattedContent || serializeCandidateData(initialData));
  const [prompt, setPrompt] = useState(initialPrompt);
  const [activeTab, setActiveTab] = useState<MobileTab>("fields");
  const [parseResult, setParseResult] = useState<CandidateParseResult | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [aiRunning, setAiRunning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(
    () => JSON.stringify({ data: initialData, rawText: initialData.rawContent || initialData.formattedContent || serializeCandidateData(initialData) }),
  );
  const currentSnapshot = JSON.stringify({ data, rawText });
  const dirty = savedSnapshot !== currentSnapshot;
  const preview = useDebouncedValue(data);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const linkGuard = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented || event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
      if (!window.confirm("Saqlanmagan o‘zgarishlar bor. Sahifadan chiqilsinmi?")) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", linkGuard, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", linkGuard, true);
    };
  }, [dirty]);

  const update = <K extends keyof CandidateStructuredData>(key: K, value: CandidateStructuredData[K]) => {
    setData((current) => ({ ...current, [key]: value }));
    setSaveState("idle");
  };

  const parse = () => {
    const result = parseCandidateText(rawText);
    setParseResult(result);
    if (result.warnings.length) toast("warning", "Matn ajratildi, ogohlantirishlar bor", `${result.warnings.length} ta ogohlantirish`);
    else toast("success", "Matn muvaffaqiyatli ajratildi");
  };

  const applyParsed = (mode: "replace" | "fill") => {
    if (!parseResult) return;
    setData((current) => mergeParsed(current, parseResult, mode));
    setParseResult(null);
    setActiveTab("fields");
    toast("success", mode === "replace" ? "Mavjud ma’lumot almashtirildi" : "Faqat bo‘sh maydonlar to‘ldirildi");
  };

  const buildMarkerText = () => {
    const text = serializeCandidateData(data);
    setRawText(text);
    setData((current) => ({ ...current, rawContent: text, formattedContent: text }));
    toast("success", "Markerli matn yaratildi");
  };

  const runAi = async () => {
    setAiRunning(true);
    try {
      const result = await structureCandidateWithAiAction({ candidateId, rawText, current: data });
      if (!result.ok || !result.data) throw new Error(result.error ?? "AI natijasi kelmadi");
      setData(result.data);
      setRawText(result.data.formattedContent);
      setParseResult(null);
      toast("success", "Jaxongir AI ma’lumotlarni strukturaladi", "Natijani tekshirib, keyin saqlang");
    } catch (error) {
      toast("error", "Jaxongir AI xatosi", error instanceof Error ? error.message : undefined);
    } finally {
      setAiRunning(false);
    }
  };

  const save = async () => {
    setSaveState("saving");
    const payload = {
      ...data,
      candidateId,
      rawContent: rawText,
      formattedContent: serializeCandidateData(data),
      slug: data.slug || slugify(data.fullName),
      sections: data.sections.map((section, order) => ({ ...section, order })),
    };
    const result = await saveCandidateEditorAction(payload);
    if (!result.ok || !result.candidateId) {
      setSaveState("error");
      toast("error", "Saqlashda xato", result.error);
      return;
    }
    const nextData = { ...data, slug: result.slug ?? payload.slug, formattedContent: payload.formattedContent, rawContent: rawText };
    setData(nextData);
    setSavedSnapshot(JSON.stringify({ data: nextData, rawText }));
    setSaveState("saved");
    toast("success", candidateId ? "Nomzod saqlandi" : "Nomzod yaratildi");
    if (!candidateId) router.push(`/candidates/${result.candidateId}`);
    else router.refresh();
  };

  const copyText = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast("success", `${label} nusxalandi`);
  };

  const downloadPrompt = () => {
    const url = URL.createObjectURL(new Blob([prompt], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nomzod-ai-prompt.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const savePrompt = async () => {
    setPromptSaving(true);
    const result = await saveCandidatePromptAction(prompt);
    setPromptSaving(false);
    if (result.ok) toast("success", "AI prompt saqlandi");
    else toast("error", "Prompt saqlanmadi", result.error);
  };

  const resetPrompt = async () => {
    setPromptSaving(true);
    const result = await resetCandidatePromptAction();
    setPromptSaving(false);
    if (result.ok && result.value) {
      setPrompt(result.value);
      toast("success", "Standart prompt tiklandi");
    } else toast("error", "Promptni tiklab bo‘lmadi", result.error);
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("bucket", "candidate-avatars");
      if (candidateId) form.set("candidate_id", candidateId);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const json = await response.json() as { url?: string; error?: string };
      if (!response.ok || !json.url) throw new Error(json.error ?? "Rasm yuklanmadi");
      update("profilePhoto", json.url);
      toast("success", "Nomzod rasmi yuklandi");
    } catch (error) {
      toast("error", "Rasm yuklanmadi", error instanceof Error ? error.message : undefined);
    } finally {
      setUploading(false);
    }
  };

  const clearAll = () => {
    if (!window.confirm("Barcha tahrir maydonlari va markerli matn tozalansinmi?")) return;
    setData({
      ...data,
      fullName: "",
      descriptionItems: [],
      birthYear: "",
      birthPlace: "",
      currentLocation: "",
      education: "",
      activityField: "",
      languages: [],
      sections: [],
      rawContent: "",
      formattedContent: "",
      unparsedContent: "",
    });
    setRawText("");
    setParseResult(null);
  };

  const diffs = useMemo(() => parseResult ? meaningfulDiffs(data, parseResult.data) : [], [data, parseResult]);

  return (
    <div className="space-y-5">
      <Card className="border-lavender/30 bg-gradient-to-br from-card via-card to-lavender/[0.06] !p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-3xl items-start gap-3">
            <span className="rounded-2xl bg-lavender/12 p-2.5 text-lavender"><Bot className="h-5 w-5" /></span>
            <div>
              <h2 className="font-display text-lg font-semibold text-ink">Nomzod ma’lumotlarini tayyorlash uchun AI prompt</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                Nomzod WhatsApp yoki Telegram orqali yuborgan barcha ma’lumotlarini quyidagi prompt bilan birga sun’iy intellektga yuboring. Sun’iy intellekt ma’lumotlarni nomzod sahifasiga mos, to‘liq va markerlar bilan ajratilgan formatda tayyorlab beradi.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copyText(prompt, "Prompt")}><Copy className="h-3.5 w-3.5" /> Nusxalash</Button>
            <Button size="sm" variant="secondary" onClick={downloadPrompt}><Download className="h-3.5 w-3.5" /> .txt</Button>
            <Button size="sm" variant="ghost" onClick={() => void resetPrompt()} disabled={promptSaving}><RotateCcw className="h-3.5 w-3.5" /> Standart</Button>
            <Button size="sm" onClick={() => void savePrompt()} disabled={promptSaving}><Save className="h-3.5 w-3.5" /> {promptSaving ? "Saqlanmoqda…" : "Promptni saqlash"}</Button>
          </div>
        </div>
        <Textarea aria-label="Nomzod uchun AI prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={8} className="mt-4 font-mono text-xs" />
      </Card>

      <div className="grid grid-cols-3 gap-2 rounded-[16px] border border-line bg-card p-1 lg:hidden" role="tablist" aria-label="Nomzod muharriri panellari">
        {(["fields", "text", "preview"] as MobileTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-[12px] px-3 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-brand ${activeTab === tab ? "bg-brand text-white" : "text-ink-soft"}`}
          >
            {tab === "fields" ? "Bo‘limlar" : tab === "text" ? "Matn" : "Preview"}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-3">
        <section className={`${activeTab === "fields" ? "block" : "hidden"} min-w-0 lg:block`} aria-label="Strukturalangan ma’lumotlar">
          <Card className="space-y-4 !p-4 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
            <div className="flex items-center gap-2 border-b border-line pb-3">
              <Clipboard className="h-4 w-4 text-brand" />
              <h2 className="font-bold text-ink">Bo‘limlarga ajratilgan ma’lumotlar</h2>
            </div>

            <div className="flex items-center gap-3 rounded-[14px] border border-line bg-surface/50 p-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-brand/8 text-brand">
                {data.profilePhoto ? <img src={data.profilePhoto} alt="Nomzod rasmi" className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-ink-soft">Nomzod rasmi</p>
                <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-card px-2.5 py-1.5 text-xs font-bold text-brand focus-within:outline-2 focus-within:outline-brand">
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                  {uploading ? "Yuklanmoqda…" : "Rasm yuklash"}
                  <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); }} />
                </label>
              </div>
            </div>
            <FormField label="Rasm URL" htmlFor="candidate-photo"><Input id="candidate-photo" value={data.profilePhoto} onChange={(event) => update("profilePhoto", event.target.value)} placeholder="https://…" /></FormField>
            <FormField label="Ism-familiyasi" htmlFor="candidate-name"><Input id="candidate-name" value={data.fullName} onChange={(event) => update("fullName", event.target.value)} /></FormField>
            <FormField label="Slug" htmlFor="candidate-slug" hint={`liderlar.uz/liderlar/${data.slug || slugify(data.fullName)}`}><Input id="candidate-slug" value={data.slug} onChange={(event) => update("slug", event.target.value)} placeholder="Ismdan avtomatik" /></FormField>
            <FormField label="Qisqa tavsif" htmlFor="candidate-description" hint="Elementlarni | belgisi bilan ajrating"><Textarea id="candidate-description" rows={2} value={data.descriptionItems.join(" | ")} onChange={(event) => update("descriptionItems", splitPipeValues(event.target.value))} placeholder="Hamshira | Volontyor | Yoshlar faoli" /></FormField>
            <div className="flex flex-wrap gap-1.5" aria-label="Tavsif elementlari">{data.descriptionItems.map((item) => <span key={item} className="rounded-full bg-brand/8 px-2.5 py-1 text-xs font-semibold text-brand">{item}</span>)}</div>
            <FormField label="Tug‘ilgan yili" htmlFor="candidate-birth-year"><Input id="candidate-birth-year" value={data.birthYear} onChange={(event) => update("birthYear", event.target.value)} placeholder="2006-yil 1-noyabr" /></FormField>
            <FormField label="Tug‘ilgan joyi" htmlFor="candidate-birth-place"><Input id="candidate-birth-place" value={data.birthPlace} onChange={(event) => update("birthPlace", event.target.value)} /></FormField>
            <FormField label="Hozirda yashash hududi" htmlFor="candidate-location"><Input id="candidate-location" value={data.currentLocation} onChange={(event) => update("currentLocation", event.target.value)} /></FormField>
            <FormField label="Ta’limi" htmlFor="candidate-education"><Textarea id="candidate-education" rows={3} value={data.education} onChange={(event) => update("education", event.target.value)} /></FormField>
            <FormField label="Faoliyat sohasi" htmlFor="candidate-activity"><Textarea id="candidate-activity" rows={2} value={data.activityField} onChange={(event) => update("activityField", event.target.value)} /></FormField>
            <FormField label="Tillar" htmlFor="candidate-languages" hint="Tillarni | belgisi bilan ajrating"><Input id="candidate-languages" value={data.languages.join(" | ")} onChange={(event) => update("languages", splitPipeValues(event.target.value))} placeholder="O‘zbek tili | Ingliz tili" /></FormField>

            <div className="border-t border-line pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><h3 className="text-sm font-bold text-ink">Kengaytirilgan bo‘limlar</h3><p className="text-xs text-ink-soft">Tutqich orqali sudrab tartiblang</p></div>
                <Button type="button" size="sm" variant="secondary" onClick={() => update("sections", [...data.sections, { id: crypto.randomUUID(), title: "", content: "", order: data.sections.length }])}><Plus className="h-3.5 w-3.5" /> Qo‘shish</Button>
              </div>
              <Reorder.Group axis="y" values={data.sections} onReorder={(sections) => update("sections", sections.map((section, order) => ({ ...section, order })))} className="space-y-3">
                {data.sections.map((section, index) => (
                  <SectionEditor
                    key={section.id}
                    section={section}
                    index={index}
                    total={data.sections.length}
                    onChange={(next) => update("sections", data.sections.map((item, itemIndex) => itemIndex === index ? next : item))}
                    onMove={(direction) => {
                      const target = index + direction;
                      if (target < 0 || target >= data.sections.length) return;
                      const sections = [...data.sections];
                      [sections[index], sections[target]] = [sections[target], sections[index]];
                      update("sections", sections.map((item, order) => ({ ...item, order })));
                    }}
                    onDelete={() => {
                      if (window.confirm(`“${section.title || "Sarlavhasiz bo‘lim"}” o‘chirilsinmi?`)) update("sections", data.sections.filter((_, itemIndex) => itemIndex !== index).map((item, order) => ({ ...item, order })));
                    }}
                  />
                ))}
              </Reorder.Group>
            </div>
          </Card>
        </section>

        <section className={`${activeTab === "text" ? "block" : "hidden"} min-w-0 lg:block`} aria-label="Markerli umumiy matn">
          <Card className="!p-4 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
            <div className="flex items-center gap-2 border-b border-line pb-3">
              <FileText className="h-4 w-4 text-brand" />
              <div><h2 className="font-bold text-ink">Umumiy matn va avtomatik ajratish</h2><p className="text-xs text-ink-soft">Markerlar faqat yangi qator boshida taniladi</p></div>
            </div>
            <Textarea aria-label="Markerli nomzod matni" value={rawText} onChange={(event) => { setRawText(event.target.value); setSaveState("idle"); }} rows={30} spellCheck className="mt-4 min-h-[34rem] resize-y font-mono text-xs leading-6" placeholder="!!!Ism-familiya&#10;&&&Tavsif | Tavsif&#10;…" />
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button onClick={parse}><Wand2 className="h-4 w-4" /> Matnni bo‘limlarga ajratish</Button>
              <Button variant="secondary" onClick={buildMarkerText}><FileText className="h-4 w-4" /> Belgilar asosida matn yaratish</Button>
              <Button variant="ai" onClick={() => void runAi()} disabled={aiRunning || rawText.trim().length < 10}>{aiRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {aiRunning ? "Jaxongir AI ishlamoqda…" : "Jaxongir AI bilan tartiblash"}</Button>
              <Button variant="ghost" onClick={clearAll}><Trash2 className="h-4 w-4" /> Tozalash</Button>
              <Button variant="secondary" onClick={() => void copyText(rawText, "Matn")}><Copy className="h-4 w-4" /> Nusxalash</Button>
              <Button onClick={() => void save()} disabled={saveState === "saving"}><Save className="h-4 w-4" /> {saveState === "saving" ? "Saqlanmoqda…" : "Saqlash"}</Button>
            </div>

            {parseResult && (
              <div className="mt-4 rounded-[16px] border border-amber/35 bg-amber/5 p-4" role="status">
                <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" /><div><p className="text-sm font-bold text-ink">Parsing natijasi</p><p className="text-xs text-ink-soft">{diffs.length ? `${diffs.join(", ")} o‘zgaradi.` : "Mavjud ma’lumot bilan mazmunli farq topilmadi."}</p></div></div>
                {parseResult.warnings.length > 0 && <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto text-xs text-ink-soft">{parseResult.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>• {warning.line ? `${warning.line}-qator: ` : ""}{warning.message}</li>)}</ul>}
                {parseResult.unparsedText && <div className="mt-3 rounded-xl border border-line bg-card p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Ajratilmagan matn</p><p className="mt-1 whitespace-pre-wrap text-xs text-ink">{parseResult.unparsedText}</p></div>}
                <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => applyParsed("replace")}>Mavjud ma’lumotni almashtirish</Button><Button size="sm" variant="secondary" onClick={() => applyParsed("fill")}>Faqat bo‘sh maydonlarni to‘ldirish</Button><Button size="sm" variant="ghost" onClick={() => setParseResult(null)}>Bekor qilish</Button></div>
              </div>
            )}
          </Card>
        </section>

        <section className={`${activeTab === "preview" ? "block" : "hidden"} min-w-0 lg:block`} aria-label="Telefon live preview">
          <Card className="!p-3 lg:sticky lg:top-4">
            <div className="mb-3 flex items-center justify-between px-1"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-green" /><h2 className="text-sm font-bold text-ink">Telefon live preview</h2></div><span className="text-[11px] text-ink-soft">Client-side · 180 ms</span></div>
            <CandidatePhonePreview data={preview} />
          </Card>
        </section>
      </div>

      <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-line bg-card/95 p-3 shadow-pop backdrop-blur">
        <div className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
          {saveState === "saving" ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : saveState === "saved" ? <Check className="h-4 w-4 text-green" /> : saveState === "error" ? <AlertTriangle className="h-4 w-4 text-coral" /> : dirty ? <span className="h-2 w-2 rounded-full bg-amber" /> : <Check className="h-4 w-4 text-green" />}
          {saveState === "saving" ? "Saqlanmoqda…" : saveState === "saved" ? "Saqlandi" : saveState === "error" ? "Saqlashda xato" : dirty ? "Saqlanmagan o‘zgarishlar bor" : "Barcha o‘zgarishlar saqlangan"}
        </div>
        <Button onClick={() => void save()} disabled={saveState === "saving" || aiRunning}><Save className="h-4 w-4" /> {saveState === "saving" ? "Saqlanmoqda…" : candidateId ? "O‘zgarishlarni saqlash" : "Nomzodni yaratish"}</Button>
      </div>
    </div>
  );
}

function SectionEditor({ section, index, total, onChange, onMove, onDelete }: {
  section: CandidateSection;
  index: number;
  total: number;
  onChange: (section: CandidateSection) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={section} dragListener={false} dragControls={controls} className="rounded-[16px] border border-line bg-surface/45 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" aria-label={`${index + 1}-bo‘limni sudrash`} onPointerDown={(event) => controls.start(event)} className="cursor-grab rounded-lg p-1 text-ink-soft hover:bg-card active:cursor-grabbing"><GripVertical className="h-4 w-4" /></button>
        <span className="mr-auto text-[11px] font-bold uppercase tracking-wide text-ink-soft">{index + 1}-bo‘lim</span>
        <button type="button" aria-label="Yuqoriga ko‘chirish" disabled={index === 0} onClick={() => onMove(-1)} className="rounded-lg p-1 text-ink-soft hover:bg-card disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
        <button type="button" aria-label="Pastga ko‘chirish" disabled={index === total - 1} onClick={() => onMove(1)} className="rounded-lg p-1 text-ink-soft hover:bg-card disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
        <button type="button" aria-label="Bo‘limni o‘chirish" onClick={onDelete} className="rounded-lg p-1 text-coral hover:bg-coral/10"><Trash2 className="h-4 w-4" /></button>
      </div>
      <Input aria-label={`${index + 1}-bo‘lim sarlavhasi`} value={section.title} onChange={(event) => onChange({ ...section, title: event.target.value })} placeholder="Bo‘lim sarlavhasi" />
      <Textarea aria-label={`${index + 1}-bo‘lim matni`} value={section.content} onChange={(event) => onChange({ ...section, content: event.target.value })} rows={5} className="mt-2" placeholder="Bo‘lim matni…" />
    </Reorder.Item>
  );
}

function CandidatePhonePreview({ data }: { data: CandidateStructuredData }) {
  const facts = [
    ["Tug‘ilgan yili", data.birthYear],
    ["Tug‘ilgan joyi", data.birthPlace],
    ["Yashash hududi", data.currentLocation],
    ["Ta’limi", data.education],
    ["Faoliyat sohasi", data.activityField],
  ].filter(([, value]) => value.trim());
  return (
    <div className="mx-auto w-full max-w-[390px] rounded-[38px] border-[7px] border-navy-deep bg-navy-deep p-1 shadow-[0_24px_70px_rgba(7,26,51,0.28)]">
      <div className="relative h-[720px] overflow-y-auto rounded-[29px] bg-[#f8fbfe] text-ink">
        <div className="sticky top-0 z-10 mx-auto h-5 w-28 rounded-b-2xl bg-navy-deep" />
        <div className="relative h-64 overflow-hidden bg-gradient-to-br from-navy-dark to-brand">
          {data.profilePhoto ? <img src={data.profilePhoto} alt={data.fullName || "Nomzod"} className="h-full w-full object-cover object-top" /> : <div className="flex h-full items-center justify-center text-white/60"><ImageIcon className="h-12 w-12" /></div>}
          <div className="absolute inset-0 bg-gradient-to-t from-navy-deep/90 via-transparent to-transparent" />
          <div className="absolute bottom-0 p-5 text-white"><h1 className="font-display text-2xl font-bold leading-tight">{stripCandidateMarkers(data.fullName) || "Nomzod ismi"}</h1><div className="mt-2 flex flex-wrap gap-1.5">{data.descriptionItems.map((item) => <span key={item} className="rounded-full border border-white/25 bg-white/10 px-2 py-1 text-[10px] font-semibold backdrop-blur">{stripCandidateMarkers(item)}</span>)}</div></div>
        </div>
        <div className="space-y-6 p-5">
          {(facts.length > 0 || data.languages.length > 0) && <section><h2 className="text-xs font-bold uppercase tracking-[0.16em] text-brand">Asosiy ma’lumotlar</h2><dl className="mt-3 grid gap-2">{facts.map(([label, value]) => <div key={label} className="rounded-xl border border-line bg-white p-3"><dt className="text-[10px] font-bold uppercase tracking-wide text-ink-soft">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-xs font-semibold leading-relaxed">{stripCandidateMarkers(value)}</dd></div>)}</dl>{data.languages.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{data.languages.map((language) => <span key={language} className="rounded-full bg-brand/8 px-2.5 py-1 text-[10px] font-bold text-brand">{stripCandidateMarkers(language)}</span>)}</div>}</section>}
          {data.sections.filter((section) => section.title.trim() || section.content.trim()).map((section) => <article key={section.id}><h2 className="font-display text-lg font-bold text-navy-dark">{stripCandidateMarkers(section.title)}</h2><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-ink-soft">{stripCandidateMarkers(section.content)}</p></article>)}
        </div>
      </div>
    </div>
  );
}
