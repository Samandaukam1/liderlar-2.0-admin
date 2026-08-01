"use client";

import { useEffect, useRef, useState } from "react";
import { Award, Download, ExternalLink, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

type GenerationState = "idle" | "loading" | "success" | "error";

export function CertificatePanel({
  candidateId,
  fullName,
  targetUrl,
  targetSource,
}: {
  candidateId: string;
  fullName: string;
  targetUrl: string | null;
  targetSource: "article" | "candidate" | null;
}) {
  const { toast } = useToast();
  const [state, setState] = useState<GenerationState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  async function generate() {
    if (state === "loading") return; // guards against duplicate clicks
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState("loading");
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/admin/candidates/${candidateId}/certificate`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Sertifikat generatsiya qilinmadi.");
      }
      const blob = await res.blob();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setPdfBlobUrl(url);
      setState("success");
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : "Sertifikat generatsiya qilinmadi.";
      setErrorMessage(message);
      setState("error");
      toast("error", "Sertifikat xatosi", message);
    }
  }

  function downloadPdf() {
    if (!pdfBlobUrl) return;
    const a = document.createElement("a");
    a.href = pdfBlobUrl;
    a.download = `${fullName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-liderlar-sertifikati.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const blocked = !targetUrl;
  const buttonLabel =
    targetSource === "article" ? "Sertifikatni PDF shaklida yuklab olish" : "Sertifikatni yaratish";

  return (
    <section className="mt-6">
      <Card className="p-6">
        <div className="mb-5 flex items-center gap-2">
          <Award className="h-5 w-5 text-brand" />
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink">Sertifikat</h3>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-4">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Nomzod ismi</dt>
                <dd className="font-semibold text-ink">{fullName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-ink-soft">QR manzili</dt>
                <dd className="min-w-0 truncate text-right font-mono text-xs text-ink">
                  {targetUrl ?? "—"}
                </dd>
              </div>
            </dl>

            {targetUrl && (
              <a
                href={targetUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-brand hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> QR manzilini ochib tekshirish
              </a>
            )}

            {blocked && (
              <div className="flex items-start gap-2 rounded-[12px] border border-coral/30 bg-coral/10 p-3.5 text-xs text-ink">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-coral" />
                <p>
                  Sertifikat QR kodi uchun nomzodning public maqolasi yoki profili avval nashr
                  qilinishi kerak.
                </p>
              </div>
            )}

            {errorMessage && (
              <div className="flex items-start gap-2 rounded-[12px] border border-coral/30 bg-coral/10 p-3.5 text-xs text-ink">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-coral" />
                <p>{errorMessage}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="ai"
                size="lg"
                className="w-full justify-center sm:w-auto"
                disabled={blocked || state === "loading"}
                onClick={() => void generate()}
              >
                {state === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : state === "success" ? (
                  <RefreshCw className="h-4 w-4" />
                ) : (
                  <Award className="h-4 w-4" />
                )}
                {state === "loading"
                  ? "Sertifikat tayyorlanmoqda…"
                  : state === "success"
                    ? "Qayta generatsiya qilish"
                    : buttonLabel}
              </Button>

              {state === "success" && pdfBlobUrl && (
                <Button variant="secondary" size="lg" onClick={downloadPdf}>
                  <Download className="h-4 w-4" /> PDF yuklab olish
                </Button>
              )}
            </div>
          </div>

          <div className="min-h-[16rem] overflow-hidden rounded-[14px] border border-line bg-surface">
            {pdfBlobUrl ? (
              <iframe
                title={`${fullName} — sertifikat preview`}
                src={pdfBlobUrl}
                className="h-full min-h-[16rem] w-full"
              />
            ) : (
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 p-6 text-center text-xs text-ink-soft">
                <Award className="h-8 w-8 text-line-strong" />
                <p>Sertifikat preview generatsiyadan keyin shu yerda ko&apos;rinadi.</p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}
