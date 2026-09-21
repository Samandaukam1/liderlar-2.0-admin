"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
  saveFlowSettingsAction,
  saveLearningSettingsAction,
  saveRecencyBucketsAction,
  refreshSalesWebhookAction,
  saveSalesRolloutAction,
  stopSalesAiAction,
} from "@/lib/actions/sales";

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

/**
 * Sotuv oqimi sozlamalari.
 *
 * `autoReplyEnabled` — eng muhim kalit: u o'chiq bo'lsa bot mijozga
 * HECH QANDAY xabar yubormaydi. Migratsiya uni `false` bilan qo'shadi,
 * ya'ni 0.2 kodi deploy bo'lgani bilan bot jim qoladi; yoqishni admin
 * ataylab qiladi.
 */
export function FlowSettingsForm({
  autoReplyEnabled,
  followupOfferReviewMinutes,
  followupArticleDecisionMinutes,
  followupLaterMinutes,
}: {
  autoReplyEnabled: boolean;
  followupOfferReviewMinutes: number;
  followupArticleDecisionMinutes: number;
  followupLaterMinutes: number;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(autoReplyEnabled);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await saveFlowSettingsAction(formData);
      if (result.ok) toast("success", "Saqlandi", result.message);
      else toast("error", "Saqlanmadi", result.error);
    });
  }

  return (
    <form action={onSubmit} className="rounded-card border border-line bg-card p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-ink">Sotuv oqimi (0.2)</h2>

      <label className="mt-3 flex items-start gap-3 rounded-card border border-line bg-surface p-3">
        <input
          type="checkbox"
          name="autoReplyEnabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="block text-sm font-bold text-ink">
            Mijozlarga avtomatik javob yozish
          </span>
          <span className="mt-0.5 block text-xs text-ink-soft">
            O‘chiq bo‘lsa bot faqat o‘qiydi va saqlaydi — hech kimga xabar
            yubormaydi. Yoqilganda ssenariy bo‘yicha javob bera boshlaydi;
            har suhbatni alohida “qo‘lga olish” bilan to‘xtatish mumkin.
          </span>
        </span>
      </label>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="followupOfferReviewMinutes">Oferta follow-up (daq.)</Label>
          <Input
            id="followupOfferReviewMinutes"
            name="followupOfferReviewMinutes"
            type="number"
            min={1}
            max={1440}
            defaultValue={followupOfferReviewMinutes}
          />
        </div>
        <div>
          <Label htmlFor="followupArticleDecisionMinutes">Maqola qarori (daq.)</Label>
          <Input
            id="followupArticleDecisionMinutes"
            name="followupArticleDecisionMinutes"
            type="number"
            min={1}
            max={1440}
            defaultValue={followupArticleDecisionMinutes}
          />
        </div>
        <div>
          <Label htmlFor="followupLaterMinutes">“Keyinroq” (daq.)</Label>
          <Input
            id="followupLaterMinutes"
            name="followupLaterMinutes"
            type="number"
            min={1}
            max={10080}
            defaultValue={followupLaterMinutes}
          />
        </div>
      </div>

      <Button type="submit" className="mt-3" disabled={pending}>
        {pending ? "Saqlanmoqda…" : "Saqlash"}
      </Button>
    </form>
  );
}

/* ---------------------- chiqarish bosqichi (28-band) --------------------- */

const ROLLOUT_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "off", label: "O‘chiq", hint: "Hech kimga yozilmaydi. Standart holat." },
  { value: "test_only", label: "Faqat sinov", hint: "Faqat admin panelidagi sinov chatida." },
  {
    value: "allowlist",
    label: "Tanlangan chatlar",
    hint: "Faqat quyida ko‘rsatilgan chat id’lariga. Birinchi real bosqich shu.",
  },
  {
    value: "percentage",
    label: "Foiz bo‘yicha",
    hint: "Suhbatlarning bir qismiga. Taqsimot barqaror: bitta mijoz doim bir tomonda qoladi.",
  },
  { value: "full", label: "To‘liq", hint: "Barcha mijozlarga. Faqat bosqichma-bosqich sinovdan keyin." },
];

export function RolloutForm({
  mode,
  allowlistChatIds,
  percentage,
}: {
  mode: string;
  allowlistChatIds: readonly number[];
  percentage: number;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(mode);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await saveSalesRolloutAction(formData);
      if (result.ok) toast("success", "Saqlandi", result.message);
      else toast("error", "Saqlanmadi", result.error);
    });
  }

  return (
    <form action={onSubmit} className="rounded-card border border-line bg-card p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-ink">Chiqarish bosqichi</h2>
      <p className="mt-1 mb-3 text-xs leading-relaxed text-ink-soft">
        O‘chiq holatdan to‘g‘ridan-to‘g‘ri hamma mijozga o‘tilmaydi. Noto‘g‘ri
        javob bir vaqtning o‘zida yuzlab odamga ketadi va uni qaytarib
        bo‘lmaydi — shuning uchun oraliq bosqichlar bor.
      </p>

      <div className="space-y-2">
        {ROLLOUT_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="flex items-start gap-3 rounded-card border border-line bg-surface p-3"
          >
            <input
              type="radio"
              name="mode"
              value={option.value}
              checked={selected === option.value}
              onChange={() => setSelected(option.value)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-bold text-ink">{option.label}</span>
              <span className="mt-0.5 block text-xs text-ink-soft">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {/*
        JIM QOLISH OGOHLANTIRISHI.
        
        "Tanlangan chatlar" ro'yxat bo'sh bo'lsa ham saqlanadi va
        bot hech kimga javob bermaydi. Admin esa "yoqdim" deb
        o'ylab yuradi — xato hech qayerda chiqmaydi. Shuning
        uchun oqibat TANLASH PAYTIDA ko'rinadi.
      */}
      {selected === "allowlist" && allowlistChatIds.length === 0 && (
        <p className="mt-3 rounded-card border border-amber/50 bg-amber/10 p-3 text-xs font-semibold text-[#946a10]">
          Ro‘yxat bo‘sh — bu rejimda bot <strong>hech kimga</strong> javob bermaydi.
          Chat id’ni suhbat sahifasidagi «Ro‘yxatga qo‘shish» tugmasi orqali
          qo‘shish qulayroq.
        </p>
      )}

      {selected === "percentage" && percentage === 0 && (
        <p className="mt-3 rounded-card border border-amber/50 bg-amber/10 p-3 text-xs font-semibold text-[#946a10]">
          Foiz 0 — bu rejimda bot <strong>hech kimga</strong> javob bermaydi.
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="allowlistChatIds">Tanlangan chat id’lari</Label>
          <Textarea
            id="allowlistChatIds"
            name="allowlistChatIds"
            rows={3}
            defaultValue={allowlistChatIds.join("\n")}
            placeholder="Har qatorda bitta"
          />
        </div>
        <div>
          <Label htmlFor="percentage">Foiz (0–100)</Label>
          <Input
            id="percentage"
            name="percentage"
            type="number"
            min={0}
            max={100}
            defaultValue={percentage}
          />
        </div>
      </div>

      <div className="mt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saqlanmoqda…" : "Saqlash"}
        </Button>
      </div>
    </form>
  );
}

/**
 * FAVQULODDA TO'XTATISH.
 *
 * Alohida forma va alohida tugma: uni sozlamalar orasidan qidirish
 * kerak bo'lmasin. Ma'lumot va rollout sozlamasi buzilmaydi —
 * faqat yangi avtomatik xabarlar to'xtaydi.
 */
export function EmergencyStopForm({ active }: { active: boolean }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    startTransition(async () => {
      const result = await stopSalesAiAction();
      if (result.ok) toast("success", "To‘xtatildi", result.message);
      else toast("error", "Bajarilmadi", result.error);
    });
  }

  return (
    <form
      action={onSubmit}
      className="rounded-card border border-coral/40 bg-coral/5 p-5 shadow-card"
    >
      <h2 className="font-display text-base font-semibold text-ink">Favqulodda to‘xtatish</h2>
      <p className="mt-1 mb-3 text-xs leading-relaxed text-ink-soft">
        Yangi avtomatik xabarlar darhol to‘xtaydi. Suhbatlar, ishlar va
        chiqarish sozlamasi o‘chirilmaydi — qayta yoqqanda qamrov joyida
        turadi.
      </p>
      <Button type="submit" variant="danger" disabled={pending || !active}>
        {pending ? "To‘xtatilmoqda…" : active ? "AI SOTUVNI TO‘XTATISH" : "Allaqachon o‘chiq"}
      </Button>
    </form>
  );
}

/**
 * Webhook'ni qayta ro'yxatdan o'tkazish.
 *
 * `allowed_updates` Telegram tomonida saqlanadi va faqat `setWebhook`
 * chaqirilganda yangilanadi. Kodga yangi update turi qo'shilgani
 * bilan Telegram uni yubormaydi — va hech qayerda xato ham chiqmaydi,
 * shunchaki hech narsa kelmaydi. Shuning uchun tugma ko'rinadigan
 * joyda turadi.
 */
export function RefreshWebhookForm() {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    startTransition(async () => {
      const result = await refreshSalesWebhookAction();
      if (result.ok) toast("success", "Yangilandi", result.message);
      else toast("error", "Bajarilmadi", result.error);
    });
  }

  return (
    <form action={onSubmit} className="rounded-card border border-line bg-card p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-ink">Webhook</h2>
      <p className="mt-1 mb-3 text-xs leading-relaxed text-ink-soft">
        Botga yangi imkoniyat qo‘shilganda (masalan anketa havolasi tugmasi)
        Telegram’dagi ro‘yxatni yangilash kerak. Kutib turgan xabarlar
        o‘chirilmaydi.
      </p>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Yangilanmoqda…" : "Webhook’ni yangilash"}
      </Button>
    </form>
  );
}
