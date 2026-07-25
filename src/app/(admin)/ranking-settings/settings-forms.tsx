"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Lock, Save } from "lucide-react";
import { Button, FormField, Input } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import {
  closePeriodAction,
  createPeriodAction,
  updateWeightsAction,
} from "@/lib/actions/rankings";
import { validateWeights } from "@/lib/ranking";

export function WeightsForm({
  periodId,
  weights,
  canEdit,
}: {
  periodId: string;
  weights: { achievements: number; monthly_activity: number; active_leadership: number };
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState(weights);
  const validation = validateWeights(values);
  const sum = values.achievements + values.monthly_activity + values.active_leadership;

  const fields = [
    { key: "achievements" as const, label: "Yutuqlar", accent: "bg-lavender" },
    { key: "monthly_activity" as const, label: "Oylik faollik", accent: "bg-mint" },
    { key: "active_leadership" as const, label: "Faol liderlik", accent: "bg-peach" },
  ];

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await updateWeightsAction(periodId, fd);
          if (res.ok) {
            toast("success", "Og‘irliklar saqlandi", "Keyingi hisoblashda qo‘llanadi");
            router.refresh();
          } else toast("error", "Xatolik", res.error);
        })
      }
      className="space-y-4"
    >
      {/* Visual weight bar */}
      <div className="flex h-3 overflow-hidden rounded-full border border-line" aria-hidden>
        {fields.map((f) => (
          <div
            key={f.key}
            className={`${f.accent} transition-all duration-300`}
            style={{ width: `${Math.max(0, Math.min(100, values[f.key]))}%` }}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {fields.map((f) => (
          <FormField key={f.key} label={`${f.label} (%)`} htmlFor={`w-${f.key}`}>
            <Input
              id={`w-${f.key}`}
              name={f.key}
              type="number"
              min={0}
              max={100}
              value={values[f.key]}
              disabled={!canEdit}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: Number(e.target.value) }))
              }
            />
          </FormField>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-xs font-bold ${validation ? "text-coral" : "text-[#2e7d44]"}`}>
          {validation ?? `Yig‘indi: ${sum}% ✓`}
        </p>
        {canEdit ? (
          <Button type="submit" size="sm" disabled={pending || Boolean(validation)}>
            <Save className="h-4 w-4" /> {pending ? "Saqlanmoqda…" : "Saqlash"}
          </Button>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-ink-soft">
            <Lock className="h-3.5 w-3.5" /> Faqat super admin o‘zgartira oladi
          </p>
        )}
      </div>
    </form>
  );
}

export function PeriodForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await createPeriodAction(fd);
          if (res.ok) {
            toast("success", "Yangi reyting davri ochildi");
            router.refresh();
          } else toast("error", "Xatolik", res.error);
        })
      }
      className="grid grid-cols-1 gap-4 sm:grid-cols-4"
    >
      <FormField label="Davr nomi" htmlFor="p-name" className="sm:col-span-2">
        <Input id="p-name" name="name" placeholder="2026 · 3-chorak" required minLength={3} />
      </FormField>
      <FormField label="Boshlanish" htmlFor="p-start">
        <Input id="p-start" name="starts_on" type="date" required />
      </FormField>
      <FormField label="Tugash" htmlFor="p-end">
        <Input id="p-end" name="ends_on" type="date" />
      </FormField>
      <div className="sm:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>
          <CalendarPlus className="h-4 w-4" />
          {pending ? "Ochilmoqda…" : "Yangi davr ochish"}
        </Button>
        <p className="mt-1.5 text-xs text-ink-soft">
          Yangi davr ochilganda joriy davr avtomatik “joriy emas” holatiga o‘tadi;
          og‘irliklar oxirgi davrdan ko‘chiriladi.
        </p>
      </div>
    </form>
  );
}

export function ClosePeriodButton({ periodId, periodName }: { periodId: string; periodName: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <Button variant="danger" size="sm" disabled={pending} onClick={() => setConfirm(true)}>
        <Lock className="h-4 w-4" /> Davrni yopish
      </Button>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          startTransition(async () => {
            const res = await closePeriodAction(periodId);
            if (res.ok) {
              toast("success", "Davr yopildi");
              router.refresh();
            } else toast("error", "Xatolik", res.error);
          });
        }}
        title="Reyting davrini yopish"
        description={`“${periodName}” davri yopiladi — natijalar muzlatiladi va qayta hisoblab bo‘lmaydi. Bu xavfli amal.`}
        confirmLabel="Davrni yopish"
        danger
        requireText="YOPISH"
      />
    </>
  );
}
