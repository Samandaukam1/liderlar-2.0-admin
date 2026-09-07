"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { saveLearningSettingsAction, saveRecencyBucketsAction } from "@/lib/actions/sales";

/**
 * Recency og'irliklari — JSON sifatida tahrirlanadi.
 *
 * Nega JSON: bucketlar soni o'zgaruvchan (bugun 5 ta, ertaga 3 ta bo'lishi
 * mumkin), qat'iy 5 ta maydonli forma esa buni cheklab qo'yardi. Server
 * tomonida qiymat baribir to'liq tekshiriladi.
 */
export function RecencyBucketsForm({ buckets }: { buckets: unknown }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(JSON.stringify(buckets, null, 2));

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await saveRecencyBucketsAction(formData);
      if (result.ok) toast("success", "Saqlandi", result.message);
      else toast("error", "Saqlanmadi", result.error);
    });
  }

  return (
    <form action={onSubmit} className="rounded-card border border-line bg-card p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-ink">Yangilik og‘irliklari</h2>
      <p className="mt-1 mb-3 text-xs leading-relaxed text-ink-soft">
        Uslub o‘rganishda har bir xabar yoshiga qarab og‘irlik oladi.
        <code className="ml-1">maxAgeDays</code> — shu kungacha (shu kun ham
        kiradi), <code>null</code> — qolgan hammasi.
        <code className="ml-1">weight</code> 0 dan 1 gacha.
      </p>
      <Label htmlFor="buckets">JSON</Label>
      <Textarea
        id="buckets"
        name="buckets"
        rows={12}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="font-mono text-xs"
      />
      <Button type="submit" className="mt-3" disabled={pending}>
        {pending ? "Saqlanmoqda…" : "Og‘irliklarni saqlash"}
      </Button>
    </form>
  );
}

export function LearningSettingsForm({
  batchSize,
  minMessagesPerConversation,
}: {
  batchSize: number;
  minMessagesPerConversation: number;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await saveLearningSettingsAction(formData);
      if (result.ok) toast("success", "Saqlandi", result.message);
      else toast("error", "Saqlanmadi", result.error);
    });
  }

  return (
    <form action={onSubmit} className="rounded-card border border-line bg-card p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-ink">O‘rganish parametrlari</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="batchSize">Bitta yugurishdagi suhbatlar</Label>
          <Input
            id="batchSize"
            name="batchSize"
            type="number"
            min={1}
            max={200}
            defaultValue={batchSize}
          />
        </div>
        <div>
          <Label htmlFor="minMessagesPerConversation">Eng kam xabar soni</Label>
          <Input
            id="minMessagesPerConversation"
            name="minMessagesPerConversation"
            type="number"
            min={1}
            max={100}
            defaultValue={minMessagesPerConversation}
          />
          <p className="mt-1 text-xs text-ink-soft">
            Shundan qisqa suhbat “o‘tkazib yuborilgan” deb belgilanadi.
          </p>
        </div>
      </div>
      <Button type="submit" className="mt-3" disabled={pending}>
        {pending ? "Saqlanmoqda…" : "Saqlash"}
      </Button>
    </form>
  );
}
