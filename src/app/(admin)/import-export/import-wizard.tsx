"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp, ChevronRight } from "lucide-react";
import { Button, FormField, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { parseCsv } from "@/lib/csv";
import { importCandidatesAction, type ImportResult, type ImportRow } from "@/lib/actions/system";
import { cn } from "@/lib/utils";

const TARGET_FIELDS = [
  { key: "full_name", label: "To‘liq ism (majburiy)" },
  { key: "slug", label: "Slug" },
  { key: "short_bio", label: "Qisqacha tavsif" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Telefon" },
  { key: "region", label: "Hudud (nomi)" },
  { key: "category", label: "Yo‘nalish (nomi)" },
] as const;

const STEPS = ["Fayl", "Moslashtirish", "Tekshirish", "Natija"];

export function ImportWizard() {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  const header = rows[0] ?? [];
  const dataRows = useMemo(() => rows.slice(1), [rows]);

  const mapped: ImportRow[] = useMemo(
    () =>
      dataRows.map((r) => {
        const obj: Record<string, string> = {};
        for (const f of TARGET_FIELDS) {
          const idx = mapping[f.key];
          if (idx != null && idx >= 0) obj[f.key] = r[idx] ?? "";
        }
        return obj as unknown as ImportRow;
      }),
    [dataRows, mapping],
  );

  const validation = useMemo(() => {
    const errors: Array<{ row: number; message: string }> = [];
    const seen = new Set<string>();
    let duplicatesInFile = 0;
    mapped.forEach((m, i) => {
      if (!m.full_name || m.full_name.trim().length < 3) {
        errors.push({ row: i + 1, message: "Ism bo‘sh yoki juda qisqa" });
      }
      const key = (m.full_name ?? "").trim().toLowerCase();
      if (key && seen.has(key)) duplicatesInFile++;
      seen.add(key);
    });
    return { errors, duplicatesInFile };
  }, [mapped]);

  return (
    <div className="rounded-card border border-line bg-card p-5 shadow-card">
      {/* Stepper */}
      <ol className="mb-6 flex items-center gap-2 overflow-x-auto">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                i < step
                  ? "bg-mint/25 text-[#1d8a6b]"
                  : i === step
                    ? "bg-gradient-to-r from-brand to-electric text-white"
                    : "bg-surface text-ink-soft",
              )}
            >
              {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </span>
            <span className={cn("whitespace-nowrap text-xs font-bold", i === step ? "text-ink" : "text-ink-soft")}>
              {s}
            </span>
            {i < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-ink-soft/40" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="flex flex-col items-center rounded-[18px] border-2 border-dashed border-line-strong px-6 py-12 text-center">
          <FileUp className="mb-3 h-8 w-8 text-brand" />
          <p className="text-sm font-bold text-ink">CSV faylni tanlang</p>
          <p className="mt-1 text-xs text-ink-soft">
            Birinchi qator — ustun sarlavhalari. UTF-8 kodlash. Maksimum 1000 qator.
          </p>
          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-[14px] bg-gradient-to-r from-brand to-electric px-5 py-2.5 text-sm font-bold text-white">
            Fayl tanlash
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await f.text();
                const parsed = parseCsv(text);
                if (parsed.length < 2) {
                  toast("error", "Fayl bo‘sh yoki noto‘g‘ri formatda");
                  return;
                }
                if (parsed.length > 1001) {
                  toast("error", "Juda ko‘p qator", "Maksimum 1000 qator import qilinadi");
                  return;
                }
                setRows(parsed);
                // Auto-map columns by header names
                const auto: Record<string, number> = {};
                parsed[0].forEach((h, idx) => {
                  const key = h.trim().toLowerCase();
                  if (/ism|name/.test(key)) auto.full_name = idx;
                  else if (/slug/.test(key)) auto.slug = idx;
                  else if (/bio|tavsif/.test(key)) auto.short_bio = idx;
                  else if (/mail/.test(key)) auto.email = idx;
                  else if (/tel|phone/.test(key)) auto.phone = idx;
                  else if (/hudud|region|viloyat/.test(key)) auto.region = idx;
                  else if (/yo['‘n]|categor|kategor/.test(key)) auto.category = idx;
                });
                setMapping(auto);
                setStep(1);
              }}
            />
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">
            CSV ustunlarini maydonlarga moslang ({dataRows.length} qator topildi):
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {TARGET_FIELDS.map((f) => (
              <FormField key={f.key} label={f.label} htmlFor={`map-${f.key}`}>
                <Select
                  id={`map-${f.key}`}
                  value={mapping[f.key]?.toString() ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [f.key]: parseInt(e.target.value, 10) }))
                  }
                >
                  <option value="">— o‘tkazib yuborish —</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Ustun ${i + 1}`}
                    </option>
                  ))}
                </Select>
              </FormField>
            ))}
          </div>
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(0)}>
              Orqaga
            </Button>
            <Button disabled={mapping.full_name == null || mapping.full_name < 0} onClick={() => setStep(2)}>
              Davom etish
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-badge bg-cyan/15 px-2 py-1 text-[#0287a0]">{mapped.length} qator</span>
            <span className="rounded-badge bg-coral/15 px-2 py-1 text-[#c43d3d]">{validation.errors.length} xato</span>
            <span className="rounded-badge bg-peach/20 px-2 py-1 text-[#b3611f]">
              {validation.duplicatesInFile} fayl ichidagi dublikat
            </span>
          </div>
          {validation.errors.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded-[14px] border border-coral/40 bg-coral/5 p-3 text-xs text-[#a33232]">
              {validation.errors.slice(0, 20).map((e, i) => (
                <p key={i}>
                  {e.row}-qator: {e.message}
                </p>
              ))}
            </div>
          )}
          <div className="overflow-x-auto rounded-table border border-line">
            <table className="w-full min-w-[600px] text-xs">
              <thead>
                <tr className="border-b border-line bg-surface/80">
                  {TARGET_FIELDS.filter((f) => mapping[f.key] != null && mapping[f.key] >= 0).map((f) => (
                    <th key={f.key} className="px-3 py-2 text-left font-bold uppercase tracking-wider text-ink-soft">
                      {f.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mapped.slice(0, 8).map((m, i) => (
                  <tr key={i} className="border-b border-line/50 last:border-0">
                    {TARGET_FIELDS.filter((f) => mapping[f.key] != null && mapping[f.key] >= 0).map((f) => (
                      <td key={f.key} className="px-3 py-2 text-ink">
                        {(m as unknown as Record<string, string>)[f.key] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mapped.length > 8 && (
            <p className="text-xs text-ink-soft">…va yana {mapped.length - 8} qator</p>
          )}
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Orqaga
            </Button>
            <Button
              disabled={pending || mapped.length === 0}
              onClick={() =>
                startTransition(async () => {
                  const res = await importCandidatesAction(mapped);
                  setResult(res);
                  setStep(3);
                  if (res.ok) router.refresh();
                })
              }
            >
              {pending ? "Import qilinmoqda…" : `Import qilish (${mapped.length})`}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="space-y-4 text-center">
          {result.ok ? (
            <>
              <CheckCircle2 className="mx-auto h-12 w-12 text-green" />
              <p className="text-lg font-bold text-ink">Import yakunlandi</p>
              <div className="flex justify-center gap-3 text-sm">
                <span className="rounded-badge bg-mint/20 px-3 py-1 font-bold text-[#1d8a6b]">
                  {result.inserted} ta qo‘shildi
                </span>
                <span className="rounded-badge bg-peach/20 px-3 py-1 font-bold text-[#b3611f]">
                  {result.skippedDuplicates} ta dublikat o‘tkazildi
                </span>
                <span className="rounded-badge bg-coral/15 px-3 py-1 font-bold text-[#c43d3d]">
                  {result.errors?.length ?? 0} ta xato
                </span>
              </div>
              {(result.errors?.length ?? 0) > 0 && (
                <div className="mx-auto max-h-40 max-w-md overflow-y-auto rounded-[14px] border border-coral/40 bg-coral/5 p-3 text-left text-xs text-[#a33232]">
                  {result.errors!.map((e, i) => (
                    <p key={i}>
                      {e.row}-qator: {e.message}
                    </p>
                  ))}
                </div>
              )}
              <p className="text-xs text-ink-soft">
                Import qilingan nomzodlar “qoralama” holatida — rollback uchun ularni
                Nomzodlar bo‘limida filtrlays iz va arxivlashingiz mumkin.
              </p>
            </>
          ) : (
            <p className="text-sm font-bold text-coral">{result.error}</p>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              setStep(0);
              setRows([]);
              setResult(null);
            }}
          >
            Yangi import
          </Button>
        </div>
      )}
    </div>
  );
}
