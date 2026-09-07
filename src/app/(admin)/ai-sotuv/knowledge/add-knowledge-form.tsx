"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Modal } from "@/components/ui/overlays";
import { Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { createManualKnowledgeAction } from "@/lib/actions/sales";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_CATEGORY_LABELS } from "@/lib/sales/types";

/**
 * Qo'lda bilim qo'shish.
 *
 * Manba suhbat SO'RALMAYDI — qo'lda kiritilgan bilimning manbasi
 * adminning o'zi, va bazadagi CHECK aynan shunga ruxsat beradi.
 *
 * Admin xohlasa darhol `approved` qilib saqlaydi: u yozgan matn AI
 * ajratganidan farqli o'laroq ko'rib chiqishni talab qilmaydi.
 */
export function AddKnowledgeForm() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createManualKnowledgeAction(formData);
      if (result.ok) {
        setOpen(false);
        toast("success", "Qo‘shildi", result.message);
      } else {
        toast("error", "Saqlanmadi", result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Bilim qo‘shish
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Qo‘lda bilim qo‘shish">
        <form action={submit} className="space-y-3">
          <div>
            <Label htmlFor="new-category">Turkum</Label>
            <Select id="new-category" name="category" defaultValue="faq">
              {KNOWLEDGE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {KNOWLEDGE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="new-question">Savol / trigger</Label>
            <Textarea
              id="new-question"
              name="question"
              rows={2}
              maxLength={500}
              placeholder="Mijoz qanday so‘raganda shu bilim ishlatilsin?"
            />
          </div>

          <div>
            <Label htmlFor="new-answer">Javob / bilim</Label>
            <Textarea id="new-answer" name="answer" rows={7} maxLength={4000} required />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="new-tags">Teglar (vergul bilan)</Label>
              <Input id="new-tags" name="tags" maxLength={300} placeholder="narx, sertifikat" />
            </div>
            <div>
              <Label htmlFor="new-priority">Prioritet</Label>
              <Input
                id="new-priority"
                name="priority"
                type="number"
                min={0}
                max={1000}
                defaultValue={100}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="new-status">Status</Label>
            <Select id="new-status" name="status" defaultValue="approved">
              <option value="approved">Tasdiqlangan (darhol ishlatiladi)</option>
              <option value="draft">Qoralama</option>
            </Select>
          </div>

          <p className="text-xs text-ink-soft">
            Qo‘lda kiritilgan bilim mos bilimlar orasida AI o‘rgangandan
            <b> ustun</b> turadi. Matn saqlashdan oldin shaxsiy ma’lumot
            uchun tekshiriladi.
          </p>

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={pending}>
              {pending ? "Saqlanmoqda…" : "Saqlash"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Bekor qilish
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
