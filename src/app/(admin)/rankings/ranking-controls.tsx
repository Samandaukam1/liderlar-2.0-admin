"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Megaphone, SlidersHorizontal } from "lucide-react";
import { Button, FormField, Input, Select, Textarea } from "@/components/ui/primitives";
import { Modal, ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import {
  adjustScoreAction,
  publishRankingAction,
  recalculateRankingsAction,
} from "@/lib/actions/rankings";

export function RankingToolbarActions({
  periodId,
  isPublished,
  candidates,
  canAdjust,
}: {
  periodId: string | null;
  isPublished: boolean;
  candidates: Array<{ id: string; full_name: string }>;
  canAdjust: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await recalculateRankingsAction();
            if (res.ok) {
              toast("success", "Reyting qayta hisoblandi", res.updated != null ? `${res.updated} ta yozuv yangilandi` : undefined);
              router.refresh();
            } else toast("error", "Xatolik", res.error);
          })
        }
      >
        <Calculator className="h-4 w-4" /> Qayta hisoblash
      </Button>
      {canAdjust && (
        <Button variant="secondary" size="sm" onClick={() => setAdjustOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" /> Qo‘lda tuzatish
        </Button>
      )}
      {periodId && !isPublished && (
        <Button size="sm" disabled={pending} onClick={() => setConfirmPublish(true)}>
          <Megaphone className="h-4 w-4" /> E’lon qilish
        </Button>
      )}

      <Modal open={adjustOpen} onClose={() => setAdjustOpen(false)} title="Qo‘lda ball tuzatish">
        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await adjustScoreAction(fd);
              if (res.ok) {
                toast("success", "Tuzatish kiritildi va reyting qayta hisoblandi");
                setAdjustOpen(false);
                router.refresh();
              } else toast("error", "Xatolik", res.error);
            })
          }
          className="space-y-4"
        >
          <FormField label="Nomzod" htmlFor="adj-candidate">
            <Select id="adj-candidate" name="candidate_id" required>
              <option value="">Tanlang…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Kategoriya" htmlFor="adj-category">
              <Select id="adj-category" name="category" defaultValue="overall">
                <option value="overall">Umumiy</option>
                <option value="achievements">Yutuqlar</option>
                <option value="monthly_activity">Oylik faollik</option>
                <option value="active_leadership">Faol liderlik</option>
              </Select>
            </FormField>
            <FormField label="Ball (±)" htmlFor="adj-delta" hint="-100 dan +100 gacha">
              <Input id="adj-delta" name="delta" type="number" step="0.5" min={-100} max={100} required />
            </FormField>
          </div>
          <FormField label="Sabab (majburiy)" htmlFor="adj-reason" hint="Audit log’da saqlanadi va reytingda ko‘rsatiladi">
            <Textarea id="adj-reason" name="reason" rows={3} required minLength={5} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAdjustOpen(false)}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saqlanmoqda…" : "Tuzatish kiritish"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        onConfirm={() => {
          setConfirmPublish(false);
          if (!periodId) return;
          startTransition(async () => {
            const res = await publishRankingAction(periodId);
            if (res.ok) {
              toast("success", "Reyting e’lon qilindi");
              router.refresh();
            } else toast("error", "Xatolik", res.error);
          });
        }}
        title="Reytingni e’lon qilish"
        description="Joriy davr natijalari liderlar.uz saytida ommaga ko‘rinadi."
        confirmLabel="E’lon qilish"
      />
    </div>
  );
}
