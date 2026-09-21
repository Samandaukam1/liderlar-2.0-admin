import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { getConversationDetail, getConversationFlowState } from "@/lib/sales/repository";
import { SALES_STAGE_LABELS, isSalesStage } from "@/lib/sales/flow/stages";
import { REFERRAL_SOURCE_LABELS } from "@/lib/sales/flow/referral";
import {
  OUTBOUND_REFUSAL_FIXES,
  OUTBOUND_REFUSAL_LABELS,
  type OutboundRefusalReason,
} from "@/lib/sales/flow/outbound-guard";
import { hasPermission } from "@/lib/permissions";
import { FlowControls } from "./flow-controls";
import { LEARNING_STATUS_LABELS } from "@/lib/sales/types";
import { formatDate, cn } from "@/lib/utils";
import { getSalesSettings } from "@/lib/sales/settings";
import { AllowlistButton } from "./allowlist-button";

export const metadata = { title: "AI Sotuv — Suhbat" };
export const dynamic = "force-dynamic";

/**
 * XOM SUHBAT.
 *
 * Bu sahifadagi matn redaksiya QILINMAYDI — bu mijozning asl yozishmasi va
 * uni tushunish uchun to'liq ko'rinishi kerak. Maxfiylik chegarasi boshqa
 * joyda: `sales.view` ruxsati (RLS + requirePermission) va bilim bazasiga
 * chiqishdagi redaksiya. Talab 7 aynan shunday ajratadi.
 */
export default async function SalesConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission("sales.view");
  const canManage = hasPermission(ctx.roles, "sales.manage");
  const { id } = await params;

  const [conversation, flow, salesSettings] = await Promise.all([
    getConversationDetail(id),
    getConversationFlowState(id),
    /*
     * Rollout sozlamasi shu yerda kerak: "ro'yxatga qo'shish"
     * tugmasi allaqachon qo'shilganini bilib turishi kerak,
     * aks holda admin har safar bosib ko'rardi.
     */
    getSalesSettings(),
  ]);
  if (!conversation) notFound();

  return (
    <div>
      <PageHeader
        title={conversation.contactName}
        description={
          conversation.contactUsername
            ? `@${conversation.contactUsername} · chat ${conversation.chatId}`
            : `Chat ${conversation.chatId}`
        }
        breadcrumbs={[
          { label: "AI Sotuv", href: "/ai-sotuv" },
          { label: "Suhbatlar", href: "/ai-sotuv/suhbatlar" },
          { label: conversation.contactName },
        ]}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {canManage && (
              <AllowlistButton
                chatId={conversation.chatId}
                alreadyListed={salesSettings.rollout.allowlistChatIds.includes(
                  conversation.chatId,
                )}
              />
            )}
            <Link
              href="/ai-sotuv/suhbatlar"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" /> Ro‘yxatga
            </Link>
          </span>
        }
      />

      {/*
        JIM QOLISH SABABI — ENG TEPADA.

        Ilgari bu ma'lumot faqat server log'ida bor edi: panelda
        "avto-javob yoqiq" deb turardi, bot esa jim edi va sababni
        bilishning yo'li yo'q edi. Endi sabab ham, tuzatish yo'li
        ham shu yerda — «Ro'yxatga qo'shish» tugmasining yonida.
      */}
      {flow?.lastRefusalReason ? (
        <section className="mb-4 rounded-card border border-coral/50 bg-coral/10 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-coral">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Oxirgi javob mijozga yuborilmadi
          </p>
          <p className="mt-1.5 text-sm text-ink">
            {refusalLabel(flow.lastRefusalReason)}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            {refusalFix(flow.lastRefusalReason)}
          </p>
          {flow.lastRefusalAt ? (
            <p className="mt-2 text-xs text-ink-soft">{formatDate(flow.lastRefusalAt)}</p>
          ) : null}
        </section>
      ) : null}

      {/* ------------------- 0.2 SOTUV OQIMI ------------------- */}
      {flow ? (
        <section className="mb-4 rounded-card border border-line bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge accent="brand">
              {isSalesStage(flow.stage) ? SALES_STAGE_LABELS[flow.stage] : flow.stage}
            </Badge>
            {/*
              IMTIYOZLI YO'NALISH BELGISI.

              Admin suhbatni ochganda BIRINCHI bilishi kerak
              bo'lgan narsa: bu odamdan pul so'ralmaydi. Belgi
              bo'lmasa, admin o'zi qo'lda to'lov so'rab yuborishi
              mumkin edi.
            */}
            {flow.referralSource ? (
              <Badge accent="mint">
                imtiyozli: {referralLabel(flow.referralSource)} — pul so‘ralmaydi
              </Badge>
            ) : null}
            {!flow.aiEnabled ? (
              <Badge accent="peach">inson nazoratida — AI jim</Badge>
            ) : (
              <Badge accent="mint">AI faol</Badge>
            )}
            {flow.paymentStatus !== "none" ? (
              <Badge accent={flow.paymentStatus === "paid" ? "mint" : "sky"}>
                to‘lov: {flow.paymentStatus}
              </Badge>
            ) : null}
            {flow.customerFullName ? (
              <span className="text-sm text-ink-soft">F.I.Sh.: {flow.customerFullName}</span>
            ) : null}

            {canManage ? (
              <span className="ml-auto">
                <FlowControls
                  conversationId={conversation.id}
                  aiEnabled={flow.aiEnabled}
                  paymentStatus={flow.paymentStatus}
                  hasEvidence={flow.evidence.length > 0}
                />
              </span>
            ) : null}
          </div>

          {flow.intakeId ? (
            <p className="mt-3 text-xs text-ink-soft">
              Anketa yaratilgan · havola prefiksi <code>{flow.intakeLinkPrefix ?? "—"}</code>
              {flow.intakeLinkExpiresAt
                ? ` · amal qilish muddati ${formatDate(flow.intakeLinkExpiresAt, true)}`
                : null}
              {/* Xom havola SAQLANMAYDI — faqat prefiks, anketa tizimidagi kabi. */}
            </p>
          ) : null}

          {flow.pendingFollowups.length > 0 ? (
            <p className="mt-2 text-xs text-ink-soft">
              Kutilayotgan follow-up:{" "}
              {flow.pendingFollowups
                .map((f) => `${f.followupType} (${formatDate(f.scheduledAt, true)})`)
                .join(", ")}
            </p>
          ) : null}

          {flow.evidence.length > 0 ? (
            <p className="mt-2 text-xs text-ink-soft">
              To‘lov cheki: {flow.evidence.length} ta ·{" "}
              {flow.evidence[0].confirmedAt
                ? `tasdiqlangan ${formatDate(flow.evidence[0].confirmedAt, true)}`
                : "tasdiqlanmagan"}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-line bg-card p-4">
        <Badge accent="cyan">{LEARNING_STATUS_LABELS[conversation.learningStatus]}</Badge>
        <span className="text-sm text-ink-soft">
          {conversation.messageCount} ta xabar
        </span>
        <span className="text-sm text-ink-soft">
          {formatDate(conversation.firstMessageAt)} — {formatDate(conversation.lastMessageAt)}
        </span>
        {conversation.learnedAt ? (
          <span className="text-sm text-ink-soft">
            O‘rganilgan: {formatDate(conversation.learnedAt, true)}
          </span>
        ) : null}
      </section>

      {conversation.learningError ? (
        <p className="mb-4 rounded-card border border-coral/40 bg-coral/8 px-4 py-3 text-sm text-ink">
          O‘rganishdagi xato: {conversation.learningError}
        </p>
      ) : null}

      <p className="mb-4 flex items-start gap-2 rounded-card border border-line bg-surface px-4 py-3 text-xs text-ink-soft">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Bu xom yozishma. Bilim bazasiga chiqarilganda telefon, karta, chek
          rekviziti va shaxsiy hujjat raqamlari avtomatik maskalanadi.
        </span>
      </p>

      {/* Botdan chiqqan xabarlar jurnali — "bot nima dedi" savoliga yozuv. */}
      {flow && flow.outbound.length > 0 ? (
        <details className="mb-4 rounded-card border border-line bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            Botdan yuborilgan xabarlar ({flow.outbound.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {flow.outbound.map((entry) => (
              <li key={entry.id} className="rounded-[10px] bg-surface px-3 py-2">
                <p className="flex flex-wrap items-center gap-2 text-[11px] text-ink-soft">
                  <Badge accent={entry.error ? "coral" : "sky"}>{entry.kind}</Badge>
                  {entry.templateKey ? <code>{entry.templateKey}</code> : null}
                  {entry.simulated ? <Badge accent="lavender">sinov</Badge> : null}
                  <span>{formatDate(entry.createdAt, true)}</span>
                </p>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-ink">
                  {entry.body}
                </p>
                {entry.error ? (
                  <p className="mt-1 text-xs text-coral">{entry.error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <section className="space-y-2.5">
        {conversation.messages.length === 0 ? (
          <p className="rounded-card border border-dashed border-line-strong bg-card px-4 py-10 text-center text-sm text-ink-soft">
            Bu suhbatda saqlangan xabar yo‘q.
          </p>
        ) : (
          conversation.messages.map((message) => (
            <article
              key={message.id}
              className={cn(
                "max-w-[80%] rounded-card border px-4 py-2.5",
                message.direction === "incoming"
                  ? "border-line bg-card"
                  : "ml-auto border-brand/30 bg-brand/8",
                message.deletedAt && "opacity-60",
              )}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                <span>{message.direction === "incoming" ? "Mijoz" : "Biz"}</span>
                <span className="font-medium normal-case tracking-normal">
                  {formatDate(message.sentAt, true)}
                </span>
                {message.messageType !== "text" ? (
                  <Badge accent="neutral">{message.messageType}</Badge>
                ) : null}
                {message.editedAt ? <Badge accent="peach">tahrirlangan</Badge> : null}
                {message.deletedAt ? <Badge accent="coral">o‘chirilgan</Badge> : null}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-ink">
                {message.text ?? <span className="italic text-ink-soft">(matnsiz xabar)</span>}
              </p>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

/*
 * Sabab kodlari bazadan keladi — ular kod ro'yxatidan chiqib
 * ketgan bo'lishi mumkin (eski qator, yangi versiya). Shuning
 * uchun xom kod ham ko'rsatiladi, sahifa esa yiqilmaydi.
 */
function isRefusalReason(value: string): value is OutboundRefusalReason {
  return value in OUTBOUND_REFUSAL_LABELS;
}

function refusalLabel(reason: string): string {
  return isRefusalReason(reason) ? OUTBOUND_REFUSAL_LABELS[reason] : reason;
}

function refusalFix(reason: string): string {
  return isRefusalReason(reason)
    ? OUTBOUND_REFUSAL_FIXES[reason]
    : "Sabab noma\u2019lum — jurnalga qarang.";
}

/** Noma'lum manba kaliti ham ko'rsatiladi — sahifa yiqilmasin. */
function referralLabel(source: string): string {
  return REFERRAL_SOURCE_LABELS[source] ?? source;
}
