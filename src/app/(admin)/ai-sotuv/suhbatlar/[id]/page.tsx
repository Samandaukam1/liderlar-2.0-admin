import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { getConversationDetail } from "@/lib/sales/repository";
import { LEARNING_STATUS_LABELS } from "@/lib/sales/types";
import { formatDate, cn } from "@/lib/utils";

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
  await requirePermission("sales.view");
  const { id } = await params;

  const conversation = await getConversationDetail(id);
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
          <Link
            href="/ai-sotuv/suhbatlar"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" /> Ro‘yxatga
          </Link>
        }
      />

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
