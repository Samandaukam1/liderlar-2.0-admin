"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Megaphone } from "lucide-react";
import { Button, FormField, Input, Textarea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import {
  broadcastNotificationAction,
  markNotificationReadAction,
} from "@/lib/actions/system";

export function MarkReadButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markNotificationReadAction(id);
          router.refresh();
        })
      }
    >
      <Check className="h-4 w-4" /> O‘qildi
    </Button>
  );
}

export function BroadcastButton() {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Megaphone className="h-4 w-4" /> E’lon yuborish
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Barcha adminlarga e’lon">
        <div className="space-y-4">
          <FormField label="Sarlavha" htmlFor="n-title">
            <Input id="n-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          <FormField label="Matn" htmlFor="n-body">
            <Textarea id="n-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </FormField>
          <div className="flex justify-end">
            <Button
              disabled={pending || title.trim().length < 3}
              onClick={() =>
                startTransition(async () => {
                  const res = await broadcastNotificationAction(title, body);
                  if (res.ok) {
                    toast("success", "E’lon yuborildi");
                    setOpen(false);
                    setTitle("");
                    setBody("");
                    router.refresh();
                  } else toast("error", "Xatolik", res.error);
                })
              }
            >
              {pending ? "Yuborilmoqda…" : "Yuborish"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
