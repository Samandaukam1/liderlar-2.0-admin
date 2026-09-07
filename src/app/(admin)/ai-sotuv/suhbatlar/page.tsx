import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, Pagination, type Column } from "@/components/admin/data-table";
import { Badge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { listConversations, type ConversationListItem } from "@/lib/sales/repository";
import {
  LEARNING_STATUSES,
  LEARNING_STATUS_LABELS,
  type LearningStatus,
} from "@/lib/sales/types";
import { formatDate } from "@/lib/utils";
import { SalesTabs, NoAutoReplyNotice } from "../sales-tabs";
import { ConversationFilters } from "./conversation-filters";

export const metadata = { title: "AI Sotuv — Suhbatlar" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const STATUS_ACCENT: Record<LearningStatus, "mint" | "sky" | "cyan" | "coral" | "neutral"> = {
  learned: "mint",
  pending: "sky",
  learning: "cyan",
  failed: "coral",
  skipped: "neutral",
};

export default async function SalesConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  await requirePermission("sales.view");
  const params = await searchParams;

  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const status = (LEARNING_STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as LearningStatus)
    : null;

  const { items, total } = await listConversations({
    page,
    pageSize: PAGE_SIZE,
    learningStatus: status,
    search: params.q ?? null,
  });

  const columns: Column<ConversationListItem>[] = [
    {
      key: "contact",
      header: "Mijoz",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{row.contactName}</p>
          {row.contactUsername ? (
            <p className="truncate text-xs text-ink-soft">@{row.contactUsername}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "messages",
      header: "Xabarlar",
      desktopOnly: true,
      render: (row) => (
        <span className="text-sm text-ink-soft">
          <b className="text-ink">{row.messageCount}</b>{" "}
          <span className="text-xs">
            ({row.incomingCount} kirdi / {row.outgoingCount} chiqdi)
          </span>
        </span>
      ),
    },
    {
      key: "last",
      header: "Oxirgi xabar",
      desktopOnly: true,
      render: (row) => (
        <span className="text-sm text-ink-soft">{formatDate(row.lastMessageAt, true)}</span>
      ),
    },
    {
      key: "learning",
      header: "O‘rganish",
      render: (row) => (
        <Badge accent={STATUS_ACCENT[row.learningStatus]}>
          {LEARNING_STATUS_LABELS[row.learningStatus]}
        </Badge>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Suhbatlar"
        description="Telegram Business orqali kelgan mijoz yozishmalari. Xom matnni faqat admin ko‘radi."
        breadcrumbs={[{ label: "AI Sotuv", href: "/ai-sotuv" }, { label: "Suhbatlar" }]}
      />
      <SalesTabs active="conversations" />
      <NoAutoReplyNotice />

      <ConversationFilters status={params.status ?? ""} query={params.q ?? ""} />

      <DataTable
        columns={columns}
        rows={items}
        rowHref={(row) => `/ai-sotuv/suhbatlar/${row.id}`}
        empty={
          <EmptyState
            icon={<MessagesSquare className="h-7 w-7" />}
            title="Suhbat yo‘q"
            description="Bot Telegram Business akkauntga ulanganidan keyin yangi yozishmalar shu yerda paydo bo‘ladi."
            action={
              <Link
                href="/ai-sotuv/sozlamalar"
                className="text-sm font-semibold text-brand hover:underline"
              >
                Ulanishni tekshirish →
              </Link>
            }
          />
        }
      />

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/ai-sotuv/suhbatlar"
        params={{ status: params.status, q: params.q }}
      />
    </div>
  );
}
