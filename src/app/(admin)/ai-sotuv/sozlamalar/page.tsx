import { ShieldAlert, Radio, Webhook } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { listConnections } from "@/lib/sales/repository";
import { getSalesSettings } from "@/lib/sales/settings";
import {
  ALLOWED_SALES_BOT_METHODS,
  getSalesBotInfo,
  getSalesWebhookInfo,
  isSalesBotConfigured,
  isSalesWebhookConfigured,
  SALES_ALLOWED_UPDATES,
} from "@/lib/sales/telegram-sales-api";
import { formatDate } from "@/lib/utils";
import { SalesTabs, NoAutoReplyNotice } from "../sales-tabs";
import { LearningSettingsForm, RecencyBucketsForm } from "./settings-forms";

export const metadata = { title: "AI Sotuv — Sozlamalar" };
export const dynamic = "force-dynamic";

export default async function SalesSettingsPage() {
  const ctx = await requirePermission("sales.view");
  const canManage = hasPermission(ctx.roles, "sales.manage");

  const [settings, connections, botInfo, webhookInfo] = await Promise.all([
    getSalesSettings(),
    listConnections(),
    getSalesBotInfo(),
    getSalesWebhookInfo(),
  ]);

  const tokenSet = isSalesBotConfigured();
  const secretSet = isSalesWebhookConfigured();

  return (
    <div>
      <PageHeader
        title="Sozlamalar"
        description="Sotuv boti ulanishi, o‘rganish parametrlari va yangilik og‘irliklari."
        breadcrumbs={[{ label: "AI Sotuv", href: "/ai-sotuv" }, { label: "Sozlamalar" }]}
      />
      <SalesTabs active="settings" />
      <NoAutoReplyNotice />

      {/* --- Bot holati --- */}
      <section className="mb-4 rounded-card border border-line bg-card p-5 shadow-card">
        <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold text-ink">
          <Radio className="h-4 w-4" /> Bot
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
              SALES_TELEGRAM_BOT_TOKEN
            </dt>
            <dd className="mt-1">
              <Badge accent={tokenSet ? "mint" : "coral"}>
                {tokenSet ? "sozlangan" : "yo‘q"}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
              SALES_TELEGRAM_WEBHOOK_SECRET
            </dt>
            <dd className="mt-1">
              <Badge accent={secretSet ? "mint" : "coral"}>
                {secretSet ? "sozlangan" : "yo‘q"}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
              Bot
            </dt>
            <dd className="mt-1 text-sm font-semibold text-ink">
              {botInfo ? `@${botInfo.username ?? botInfo.id}` : "aniqlanmadi"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
              Webhook manzili
            </dt>
            <dd className="mt-1 truncate text-sm text-ink">
              {webhookInfo?.url ?? "—"}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-ink-soft">
          Webhook yo‘li: <code>/api/telegram-sales/webhook</code>. Post yuboruvchi
          bot (<code>TELEGRAM_BOT_TOKEN</code>) butunlay alohida ishlaydi va bu
          sozlamalar unga tegmaydi.
        </p>

        {webhookInfo?.lastErrorMessage ? (
          <p className="mt-3 rounded-card border border-coral/40 bg-coral/8 px-3 py-2 text-xs text-ink">
            Telegram’dagi oxirgi xato ({formatDate(webhookInfo.lastErrorDate, true)}):{" "}
            {webhookInfo.lastErrorMessage}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-soft">Eshitiladigan update’lar:</span>
          {SALES_ALLOWED_UPDATES.map((u) => (
            <Badge key={u} accent="sky">
              {u}
            </Badge>
          ))}
        </div>
      </section>

      {/* --- Avto-javob yo'qligining kafolati --- */}
      <section className="mb-4 rounded-card border border-line bg-surface p-5">
        <h2 className="mb-2 flex items-center gap-2 font-display text-base font-semibold text-ink">
          <ShieldAlert className="h-4 w-4" /> Avto-javob himoyasi
        </h2>
        <p className="text-xs leading-relaxed text-ink-soft">
          Sotuv boti Telegram’ning faqat quyidagi metodlarini chaqira oladi.
          Ro‘yxat oq ro‘yxat (allowlist) sifatida ishlaydi: unda yo‘q har qanday
          metod — <code>sendMessage</code> ham — kod darajasida xato tashlaydi.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ALLOWED_SALES_BOT_METHODS.map((method) => (
            <Badge key={method} accent="mint">
              {method}
            </Badge>
          ))}
        </div>
      </section>

      {/* --- Business ulanishlari --- */}
      <section className="mb-4 rounded-card border border-line bg-card p-5 shadow-card">
        <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold text-ink">
          <Webhook className="h-4 w-4" /> Business ulanishlari
        </h2>
        {connections.length === 0 ? (
          <p className="text-sm text-ink-soft">
            Hali ulanish yo‘q. Telegram’da <b>Sozlamalar → Biznes → Chatlarni
            avtomatlashtirish</b> bo‘limidan botni ulang; birinchi
            <code className="mx-1">business_connection</code> update’i kelishi
            bilan u shu yerda paydo bo‘ladi.
          </p>
        ) : (
          <ul className="space-y-2">
            {connections.map((connection) => (
              <li
                key={connection.id}
                className="flex flex-wrap items-center gap-3 rounded-[10px] bg-surface px-3 py-2"
              >
                <Badge accent={connection.isEnabled ? "mint" : "neutral"}>
                  {connection.isEnabled ? "aktiv" : "o‘chirilgan"}
                </Badge>
                <span className="text-sm font-semibold text-ink">
                  {connection.ownerUsername
                    ? `@${connection.ownerUsername}`
                    : (connection.ownerTelegramUserId ?? "—")}
                </span>
                <span className="text-xs text-ink-soft">
                  Ulangan: {formatDate(connection.connectedAt, true)}
                </span>
                {/* 0.1 da bu qiymat faqat qayd etiladi — bot baribir yozmaydi. */}
                <span className="text-xs text-ink-soft">
                  Telegram javob huquqi: {connection.canReply ? "bor" : "yo‘q"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RecencyBucketsForm buckets={settings.recencyBuckets} />
          <LearningSettingsForm
            batchSize={settings.learning.batchSize}
            minMessagesPerConversation={settings.learning.minMessagesPerConversation}
          />
        </div>
      ) : (
        <p className="rounded-card border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
          Sozlamalarni o‘zgartirish uchun <b>sales.manage</b> ruxsati kerak.
        </p>
      )}
    </div>
  );
}
