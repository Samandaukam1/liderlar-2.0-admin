"use client";

import { useState, useTransition } from "react";
import { Bot, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/admin/badges";
import {
  registerMemberWebhookAction,
  setMemberMenuButtonAction,
  setMehrFlagAction,
  type MehrActionResult,
} from "@/lib/actions/mehr";
import { MEHR_FLAG_KEYS, type MehrFlags } from "@/lib/mehr/flag-keys";

export interface BotStatusView {
  configured: boolean;
  username: string | null;
  webhookUrl: string | null;
  pendingUpdates: number | null;
  lastError: string | null;
  /** Qaysi environment o'zgaruvchilari yetishmaydi. QIYMATLAR EMAS. */
  missingEnv: string[];
  /** Token adashtirilgan nom bilan qo'shilgan bo'lsa — o'sha NOM. */
  misnamedToken: string | null;

  /** Webhook va Mini App uchun ishlatiladigan manzil. */
  resolvedOrigin: string | null;
  /** Qaysi environment o'zgaruvchisidan olingani. */
  originSource: string | null;
  /** Manzil yaroqsiz bo'lsa — nega. */
  originProblem: string | null;
}

/*
 * Hali hech nimani to'smaydigan bayroqlar.
 *
 * Panel "o'chiq" deb ko'rsatib, aslida hech nimani to'smasa,
 * bu YOLG'ON XOTIRJAMLIK beradi: odam "yopiq ekan" deb
 * o'ylab yuradi. Shuning uchun ochiq aytiladi.
 *
 * Ro'yxat `tests/mehr-schema.test.ts` dagi NOT_YET_ENFORCED
 * bilan bir xil bo'lishi kerak.
 */
const NOT_YET_BUILT: Partial<Record<keyof MehrFlags, string>> = {
  publicEnabled: "Ommaviy MEHR sahifalari hali qurilmagan",
  memberAuthEnabled: "Kirish allaqachon ishlaydi — bu bayroq hech nimani to'smaydi",
  referralPointsEnabled: "Referral dvigateli hali qurilmagan",
};

const FLAG_LABEL: Record<keyof MehrFlags, string> = {
  publicEnabled: "Ommaviy sahifalar",
  activityCreationEnabled: "Tadbir yaratish va seans",
  qrCheckinEnabled: "QR check-in",
  pointsEnabled: "Ball berish",
  certificatesEnabled: "Sertifikatlar",
  memberAuthEnabled: "A'zo autentifikatsiyasi",
  memberBotEnabled: "A'zo boti",
  accountActivationEnabled: "Nomzod hisobini faollashtirish",
  referralPointsEnabled: "Referral ballari",
};

/**
 * MEHR sozlamalari — bot va bayroqlar.
 *
 * "Hammasini yoq" tugmasi ATAYLAB yo'q. Bosqichma-bosqich
 * yoqish — bu ehtiyotkorlik emas, talab (§43): bir vaqtning
 * o'zida hamma narsa ochilsa, nimadir buzilganda qaysi biri
 * sabab bo'lganini aniqlab bo'lmaydi.
 */
export function BotSettings({
  status,
  flags,
}: {
  status: BotStatusView;
  flags: MehrFlags;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<MehrActionResult | null>(null);
  const [local, setLocal] = useState(flags);

  function run(fn: () => Promise<MehrActionResult>) {
    startTransition(async () => {
      const r = await fn();
      setResult(r);
    });
  }

  return (
    <section className="mb-8 rounded-lg border border-border-soft bg-paper p-5">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-brand" aria-hidden />
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
          Bot va bayroqlar
        </h2>
      </div>

      {/*
        NOMI ALMASHIB KETGAN TOKEN.

        "Yo'q" degan xabar sababni ko'rsatmaydi va odam tokenni
        qayta-qayta qo'shib, nega ishlamayotganini tushunmaydi.
      */}
      {status.misnamedToken && (
        <div className="mt-3 rounded-lg border border-amber/50 bg-amber/10 p-3">
          <p className="text-sm font-bold text-[#946a10]">Token nomi noto&apos;g&apos;ri</p>
          <p className="mt-1 text-xs text-ink-soft">
            Vercel&apos;da <code className="font-mono">{status.misnamedToken}</code> bor, lekin kod{" "}
            <code className="font-mono">MEMBER_TELEGRAM_BOT_TOKEN</code> ni kutadi.
            Tokenni to&apos;g&apos;ri nom bilan qo&apos;shib, qaytadan deploy qiling.
          </p>
        </div>
      )}

      {/* ---- Yetishmayotgan sozlamalar ---- */}
      {status.missingEnv.length > 0 && (
        <div className="mt-3 rounded-lg border border-coral/40 bg-coral/10 p-3">
          <p className="flex items-center gap-1.5 text-sm font-bold text-[#c43d3d]">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Environment sozlamalari yetishmaydi
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-ink-soft">
            {status.missingEnv.map((name) => (
              <li key={name}>
                • <code className="font-mono">{name}</code>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">
            Bularni Vercel&apos;ga qo&apos;shib, qaytadan deploy qiling.
          </p>
        </div>
      )}

      {/*
        MANZIL MUAMMOSI — TUGMADAN OLDIN.

        Telegram "An HTTPS URL must be provided" deb rad etgani
        panelda emas, tugma javobida chiqardi va sabab
        sozlamada ekani ko'rinmasdi.
      */}
      {status.originProblem && (
        <div className="mt-3 rounded-lg border border-coral/40 bg-coral/10 p-3">
          <p className="flex items-center gap-1.5 text-sm font-bold text-[#c43d3d]">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Manzil yaroqsiz
          </p>
          <p className="mt-1 text-xs text-ink-soft">{status.originProblem}</p>
          <p className="mt-1.5 text-xs text-ink-soft">
            Telegram webhook va Mini App uchun <strong>HTTPS</strong> manzil talab qiladi va
            lokal manzilga yeta olmaydi.
          </p>
        </div>
      )}

      {/* ---- Bot holati ---- */}
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <Row label="Bot">
          {status.configured ? (
            status.username ? (
              <span className="font-mono">@{status.username}</span>
            ) : (
              <span className="text-ink-soft">token bor, javob yo&apos;q</span>
            )
          ) : (
            <Badge accent="coral">token sozlanmagan</Badge>
          )}
        </Row>

        <Row label="Ishlatiladigan manzil">
          {status.resolvedOrigin ? (
            <span className="break-all font-mono text-xs">
              {status.resolvedOrigin}
              <span className="ml-1.5 font-sans text-ink-soft">({status.originSource})</span>
            </span>
          ) : (
            <Badge accent="coral">aniqlanmadi</Badge>
          )}
        </Row>

        <Row label="Webhook">
          {status.webhookUrl ? (
            <span className="break-all font-mono text-xs">{status.webhookUrl}</span>
          ) : (
            <Badge accent="amber">o&apos;rnatilmagan</Badge>
          )}
        </Row>

        {status.pendingUpdates !== null && status.pendingUpdates > 0 && (
          <Row label="Navbatda">
            <Badge accent="amber">{status.pendingUpdates} ta xabar</Badge>
          </Row>
        )}

        {/*
          Telegram'ning oxirgi xatosi — eng foydali diagnostika.
          U bo'lsa, webhook o'rnatilgan-u, ishlamayapti degani.
        */}
        {status.lastError && (
          <Row label="Oxirgi xato">
            <span className="text-xs text-[#c43d3d]">{status.lastError}</span>
          </Row>
        )}
      </div>

      <button
        type="button"
        disabled={pending || !status.configured || !status.resolvedOrigin}
        onClick={() => run(registerMemberWebhookAction)}
        className="mt-3 inline-flex items-center gap-1.5 rounded-badge border border-border-soft px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-ice disabled:opacity-40"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden />
        Webhook&apos;ni o&apos;rnatish
      </button>

      {/*
        Mini App tugmasi ham PANELDAN. BotFather'da qo'lda
        qo'yish mumkin, lekin manzil o'zgarganda uni yangilashni
        unutish oson — va tugma jimgina eski manzilga olib borardi.
      */}
      <button
        type="button"
        disabled={pending || !status.configured || !status.resolvedOrigin}
        onClick={() => run(setMemberMenuButtonAction)}
        className="ml-2 mt-3 inline-flex items-center gap-1.5 rounded-badge border border-border-soft px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-ice disabled:opacity-40"
      >
        <Bot className="h-3.5 w-3.5" aria-hidden />
        Mini App tugmasini o&apos;rnatish
      </button>

      {/* ---- Bayroqlar ---- */}
      <h3 className="mt-6 text-xs font-bold uppercase tracking-wide text-ink-soft">
        Xususiyatlar
      </h3>
      <p className="mt-1 text-xs text-ink-soft">
        Har birini alohida yoqing va tekshiring — birdaniga emas.
      </p>

      <ul className="mt-2 divide-y divide-border-soft">
        {(Object.keys(FLAG_LABEL) as (keyof MehrFlags)[]).map((field) => {
          const on = local[field];
          const notBuilt = NOT_YET_BUILT[field];

          return (
            <li key={field} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="text-sm font-semibold text-ink">{FLAG_LABEL[field]}</span>
                <span className="ml-2 font-mono text-[11px] text-ink-soft">
                  {MEHR_FLAG_KEYS[field]}
                </span>
                {notBuilt && (
                  <span className="mt-0.5 block text-[11px] text-ink-soft">⚠️ {notBuilt}</span>
                )}
              </span>

              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const next = !on;
                  // Darhol ko'rsatamiz; xato bo'lsa server javobida ko'rinadi.
                  setLocal((prev) => ({ ...prev, [field]: next }));
                  run(async () => {
                    const r = await setMehrFlagAction({
                      key: MEHR_FLAG_KEYS[field],
                      enabled: next,
                    });
                    if (!r.ok) setLocal((prev) => ({ ...prev, [field]: on }));
                    return r;
                  });
                }}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-badge border px-3 py-1 text-xs font-bold transition disabled:opacity-40 ${
                  on
                    ? "border-green/50 bg-green/15 text-[#2e7d44]"
                    : "border-border-soft text-ink-soft hover:bg-ice"
                }`}
              >
                {on && <CheckCircle2 className="h-3 w-3" aria-hidden />}
                {on ? "Yoqilgan" : "O'chiq"}
              </button>
            </li>
          );
        })}
      </ul>

      {result && (
        <p
          className={`mt-3 text-xs font-semibold ${
            result.ok ? "text-[#2e7d44]" : "text-[#c43d3d]"
          }`}
        >
          {result.ok ? result.message : result.error}
        </p>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</span>
      {children}
    </div>
  );
}
