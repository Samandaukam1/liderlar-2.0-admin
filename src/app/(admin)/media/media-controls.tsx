"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import { deleteMediaAction } from "@/lib/actions/system";

export function MediaUploadButton() {
  const router = useRouter();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  return (
    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[14px] bg-gradient-to-r from-brand to-electric px-4 text-sm font-bold text-white shadow-[0_8px_24px_rgba(22,119,255,0.28)] transition hover:brightness-110">
      <UploadCloud className="h-4 w-4" />
      {uploading ? "Yuklanmoqda…" : "Fayl yuklash"}
      <input
        type="file"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length === 0) return;
          setUploading(true);
          let okCount = 0;
          for (const f of files) {
            try {
              const fd = new FormData();
              fd.set("file", f);
              fd.set(
                "bucket",
                f.type.startsWith("image/") ? "candidate-gallery" : "admin-private-files",
              );
              const res = await fetch("/api/upload", { method: "POST", body: fd });
              if (res.ok) okCount++;
              else {
                const json = (await res.json()) as { error?: string };
                toast("error", `${f.name} yuklanmadi`, json.error);
              }
            } catch {
              toast("error", `${f.name} yuklanmadi`, "Tarmoq xatosi — qayta urinib ko‘ring");
            }
          }
          if (okCount > 0) toast("success", `${okCount} ta fayl yuklandi`);
          setUploading(false);
          router.refresh();
        }}
      />
    </label>
  );
}

export function MediaDeleteButton({ id, fileName }: { id: string; fileName: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="ghost" size="sm" className="text-coral hover:bg-coral/10" onClick={() => setConfirm(true)}>
        <Trash2 className="h-4 w-4" />
      </Button>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          startTransition(async () => {
            const res = await deleteMediaAction(id);
            if (res.ok) {
              toast("success", "Fayl o‘chirildi");
              router.refresh();
            } else toast("error", "Xatolik", res.error);
          });
        }}
        title="Faylni o‘chirish"
        description={`“${fileName}” storage’dan o‘chiriladi. Bu fayldan foydalanayotgan sahifalarda rasm ko‘rinmay qoladi.`}
        confirmLabel="O‘chirish"
        danger
        loading={pending}
      />
    </>
  );
}
