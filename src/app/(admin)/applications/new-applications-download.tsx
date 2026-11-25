"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { Modal } from "@/components/ui/overlays";
import { Button, Input, Label } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { completeNewApplicationsExport, prepareNewApplicationsExport } from "./new-applications-actions";

type Download = Extract<Awaited<ReturnType<typeof prepareNewApplicationsExport>>, { status: "ready" }>;

function downloadText(file: Download) {
  const url = URL.createObjectURL(new Blob([file.text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function NewApplicationsDownload() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [chooseStart, setChooseStart] = useState(false);
  const [startAt, setStartAt] = useState("");
  const [retryFile, setRetryFile] = useState<Download | null>(null);

  function run(start?: string) {
    if (pending) return;
    startTransition(async () => {
      try {
        const file = retryFile ?? await prepareNewApplicationsExport(start);
        if (file.status === "start_required") {
          if (start) toast("warning", "Toshkent vaqti bo‘yicha o‘tgan sana va vaqtni tanlang");
          setChooseStart(true);
          return;
        }
        if (file.status === "error") {
          toast("error", "Eksport xatosi", file.message);
          return;
        }
        setChooseStart(false);
        if (file.status === "empty") {
          toast("info", "Yangi arizalar yo‘q");
          return;
        }

        setRetryFile(file);
        downloadText(file);
        const result = await completeNewApplicationsExport(file.receipt);
        if (result.status === "error") {
          toast("error", "Statusni yangilab bo‘lmadi", "Shu fayl bilan qayta urinib ko‘ring.");
          return;
        }

        setRetryFile(null);
        router.refresh();
        if (result.status === "superseded") {
          toast("info", "Arizalar holati o‘zgargan", "Yangilangan ro‘yxat uchun tugmani yana bosing.");
        } else {
          toast(
            "success",
            `${file.count} ta ariza yuklab olindi`,
            "Eng yangi ariza «Ko‘rilmoqda» holatida.",
          );
        }
      } catch {
        toast("error", "Eksport yakunlanmadi", "Yuklab olishga qayta urinib ko‘ring.");
      }
    });
  }

  function submitStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(startAt);
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => run()} disabled={pending} aria-busy={pending}>
        <Download className="h-4 w-4" aria-hidden />
        {pending ? "Tayyorlanmoqda…" : retryFile ? "Yuklab olishni qayta urinish" : "Yangi arizalarni yuklab olish"}
      </Button>

      <Modal open={chooseStart} onClose={() => setChooseStart(false)} title="Eksport boshlanishi">
        <form onSubmit={submitStart} className="space-y-4">
          <p className="text-sm text-ink-soft">
            Hozircha «Ko‘rilmoqda» ariza yo‘q. Birinchi eksport qaysi sana va vaqtdan boshlanishini belgilang.
          </p>
          <div>
            <Label htmlFor="new-applications-start">Boshlanish vaqti (Toshkent)</Label>
            <Input
              id="new-applications-start"
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setChooseStart(false)}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={pending}>Yuklab olish</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
