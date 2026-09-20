"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, KeyRound, Copy, Check, Ban, RotateCcw, Mail } from "lucide-react";
import { Badge } from "@/components/admin/badges";
import {
  createActivationAction,
  blockAccountAction,
  restoreAccountAction,
  sendPasswordResetAction,
  type AccountActionResult,
} from "@/lib/actions/accounts";
import {
  ACCOUNT_STATE_LABEL,
  ACCOUNT_FILTER_LABEL,
  type AccountRow,
  type AccountFilter,
  type AccountState,
} from "@/lib/accounts/account-types";

const STATE_ACCENT: Record<AccountState, "neutral" | "green" | "amber" | "coral" | "sky"> = {
  no_account: "neutral",
  activation_pending: "sky",
  active: "green",
  blocked: "coral",
  needs_attention: "coral",
};

const FILTERS: AccountFilter[] = [
  "all",
  "unlinked",
  "pending",
  "linked",
  "telegram",
  "blocked",
  "attention",
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "short", year: "numeric" })
    : "—";
}

export function AccountTable({
  rows,
  total,
  activeFilter,
  search,
  canManage,
  activationEnabled,
}: {
  rows: AccountRow[];
  total: number;
  activeFilter: AccountFilter;
  search: string;
  canManage: boolean;
  activationEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(search);
  const [feedback, setFeedback] = useState<Record<string, AccountActionResult>>({});
  const [copied, setCopied] = useState<string | null>(null);

  function go(filter: AccountFilter, q: string) {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (q.trim()) params.set("q", q.trim());
    router.push(`/foydalanuvchilar${params.toString() ? `?${params}` : ""}`);
  }

  function run(id: string, fn: () => Promise<AccountActionResult>) {
    startTransition(async () => {
      const result = await fn();
      setFeedback((prev) => ({ ...prev, [id]: result }));
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => go(f, query)}
            className={`rounded-badge border px-3 py-1.5 text-xs font-bold transition ${
              activeFilter === f
                ? "border-brand bg-brand/15 text-brand"
                : "border-border-soft text-ink-soft hover:bg-ice"
            }`}
          >
            {ACCOUNT_FILTER_LABEL[f]}
          </button>
        ))}

        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go(activeFilter, query);
          }}
        >
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ism yoki slug"
              aria-label="Nomzod qidirish"
              className="h-8 w-52 rounded-badge border border-border-soft bg-paper pl-8 pr-3 text-xs text-ink placeholder:text-ink-soft/60 focus:border-brand focus:outline-none"
            />
          </div>
        </form>
      </div>

      <p className="mb-2 text-xs text-ink-soft">{total.toLocaleString("uz-UZ")} ta yozuv</p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border-soft bg-paper p-8 text-center">
          <p className="text-sm font-semibold text-ink">Natija yo&apos;q</p>
          <p className="mt-1 text-xs text-ink-soft">Filtr yoki qidiruvni o&apos;zgartirib ko&apos;ring.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const result = feedback[row.candidateId];

            return (
              <li key={row.candidateId} className="rounded-lg border border-border-soft bg-paper p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-ink">{row.fullName}</span>
                      <Badge accent={STATE_ACCENT[row.state]}>
                        {ACCOUNT_STATE_LABEL[row.state]}
                      </Badge>
                      {row.telegramLinked && (
                        <Badge accent="mint">
                          Telegram{row.telegramUsername ? ` @${row.telegramUsername}` : ""}
                        </Badge>
                      )}
                    </div>

                    <p className="mt-1 text-xs text-ink-soft">
                      {row.regionName ?? "hudud ko'rsatilmagan"}
                      {" · "}
                      {row.candidateStatus === "published" ? "nashr qilingan" : row.candidateStatus}
                      {row.lastLoginAt ? ` · oxirgi kirish: ${formatDate(row.lastLoginAt)}` : ""}
                      {row.activationExpiresAt
                        ? ` · havola amal qiladi: ${formatDate(row.activationExpiresAt)}`
                        : ""}
                    </p>

                    {row.slug && (
                      <Link
                        href={`/candidates/${row.candidateId}`}
                        className="mt-1 inline-block text-xs font-semibold text-brand hover:underline"
                      >
                        Nomzod sahifasi →
                      </Link>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {!row.hasAccount && (
                        <button
                          type="button"
                          disabled={pending || !activationEnabled}
                          onClick={() =>
                            run(row.candidateId, () => createActivationAction(row.candidateId))
                          }
                          title={
                            activationEnabled
                              ? undefined
                              : "member.account_activation_enabled o'chiq"
                          }
                          className="inline-flex items-center gap-1.5 rounded-badge border border-brand/50 bg-brand/10 px-3 py-1.5 text-xs font-bold text-brand transition hover:bg-brand/20 disabled:opacity-40"
                        >
                          <KeyRound className="h-3.5 w-3.5" aria-hidden />
                          Havola yaratish
                        </button>
                      )}

                      {row.profileId && row.state !== "blocked" && (
                        <>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              run(row.candidateId, () => sendPasswordResetAction(row.profileId!))
                            }
                            className="inline-flex items-center gap-1.5 rounded-badge border border-border-soft px-3 py-1.5 text-xs font-bold text-ink-soft transition hover:bg-ice disabled:opacity-40"
                          >
                            <Mail className="h-3.5 w-3.5" aria-hidden />
                            Parolni tiklash
                          </button>
                          <BlockButton
                            disabled={pending}
                            onBlock={(reason) =>
                              run(row.candidateId, () =>
                                blockAccountAction({ profileId: row.profileId!, reason }),
                              )
                            }
                          />
                        </>
                      )}

                      {row.profileId && row.state === "blocked" && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(row.candidateId, () => restoreAccountAction(row.profileId!))
                          }
                          className="inline-flex items-center gap-1.5 rounded-badge border border-green/50 bg-green/15 px-3 py-1.5 text-xs font-bold text-[#2e7d44] transition hover:bg-green/25 disabled:opacity-40"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                          Tiklash
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/*
                  HAVOLA — PAROL EMAS.

                  U bir martalik va muddatli. Nusxalab olish
                  uchun ko'rsatiladi, lekin hech qayerda
                  saqlanmaydi: sahifa yangilansa yo'qoladi.
                */}
                {result?.ok && result.link && (
                  <div className="mt-3 rounded-lg border border-brand/40 bg-brand/5 p-3">
                    <p className="text-xs font-bold text-ink">Bir martalik faollashtirish havolasi</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-ink-soft">
                      {result.link}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(result.link!);
                        setCopied(row.candidateId);
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-badge border border-border-soft bg-paper px-3 py-1 text-xs font-bold text-ink transition hover:bg-ice"
                    >
                      {copied === row.candidateId ? (
                        <>
                          <Check className="h-3.5 w-3.5" aria-hidden />
                          Nusxalandi
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" aria-hidden />
                          Nusxalash
                        </>
                      )}
                    </button>
                    <p className="mt-2 text-[11px] text-ink-soft">
                      Bu <strong>parol emas</strong>. Nomzod havolani ochib, parolini o&apos;zi
                      qo&apos;yadi — uni hech kim ko&apos;rmaydi. Havola bir marta ishlaydi.
                    </p>
                  </div>
                )}

                {result && (
                  <p
                    className={`mt-2 text-xs font-semibold ${
                      result.ok ? "text-[#2e7d44]" : "text-[#c43d3d]"
                    }`}
                  >
                    {result.ok ? result.message : result.error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Bloklash — sababsiz bo'lmaydi.
 *
 * Sabab keyin "nega bloklangan edi?" degan savolga javob
 * beradi va tiklashda ham ko'rinib turadi.
 */
function BlockButton({
  disabled,
  onBlock,
}: {
  disabled: boolean;
  onBlock: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-badge border border-coral/50 px-3 py-1.5 text-xs font-bold text-[#c43d3d] transition hover:bg-coral/10 disabled:opacity-40"
      >
        <Ban className="h-3.5 w-3.5" aria-hidden />
        Bloklash
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Bloklash sababi"
        aria-label="Bloklash sababi"
        className="h-8 w-44 rounded-badge border border-border-soft bg-paper px-2.5 text-xs text-ink focus:border-brand focus:outline-none"
      />
      <button
        type="button"
        disabled={disabled || reason.trim().length < 3}
        onClick={() => {
          onBlock(reason);
          setOpen(false);
          setReason("");
        }}
        className="rounded-badge border border-coral/50 bg-coral/15 px-2.5 py-1.5 text-xs font-bold text-[#c43d3d] disabled:opacity-40"
      >
        Tasdiqlash
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-badge border border-border-soft px-2 py-1.5 text-xs text-ink-soft"
      >
        ✕
      </button>
    </div>
  );
}
