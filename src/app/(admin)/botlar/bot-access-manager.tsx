"use client";

import * as React from "react";
import { useTransition } from "react";
import { Bell, MousePointerClick, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { Button, Input, Label, Textarea } from "@/components/ui/primitives";
import { Badge } from "@/components/admin/badges";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  BOTS,
  BOT_PERMISSIONS,
  cleanPermissions,
  parseTelegramId,
  TELEGRAM_ID_PROBLEM_TEXT,
  type BotPermission,
} from "@/lib/bot-access/catalog";
import { deleteBotAccessAction, saveBotAccessAction, setBotAccessActiveAction } from "@/lib/actions/bot-access";

export interface BotAccessRowView {
  id: string;
  telegramId: string;
  displayName: string;
  note: string;
  permissions: string[];
  isActive: boolean;
  updatedAt: string;
}

interface Draft {
  id: string | null;
  telegramId: string;
  displayName: string;
  note: string;
  permissions: BotPermission[];
  isActive: boolean;
}

const EMPTY: Draft = { id: null, telegramId: "", displayName: "", note: "", permissions: [], isActive: true };

/** Ogohlantirish: hech kimda bo'lmasa bot nima qiladi. */
const MISSING_WARNING: Partial<Record<BotPermission, string>> = {
  "studio.posts": "Hech kimda “Tayyor postlarni qabul qilish” yo‘q — bunday holatda tayyor postlar BARCHA bot obunachilariga ketadi.",
  "studio.payments": "Hech kimda “To‘lov savollari” yo‘q — to‘lov savollari hech kimga yuborilmaydi.",
  "sales.operator": "AI sotuv botida operator yo‘q — operatorga uzatilgan suhbatlar hech kimga yetmaydi.",
};

export function BotAccessManager({ rows, studioUsername }: { rows: BotAccessRowView[]; studioUsername: string | null }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busyCell, setBusyCell] = React.useState<string | null>(null);

  const active = rows.filter((row) => row.isActive);
  const warnings = (Object.keys(MISSING_WARNING) as BotPermission[])
    .filter((permission) => !active.some((row) => row.permissions.includes(permission)))
    .map((permission) => MISSING_WARNING[permission]!);

  function run(action: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast("success", "Saqlandi", result.message);
        after?.();
      } else {
        toast("error", "Saqlanmadi", result.error);
      }
    });
  }

  /** Jadval katakchasi — bitta ruxsatni darhol yoqadi yoki o'chiradi. */
  function toggleCell(row: BotAccessRowView, permission: BotPermission) {
    const has = row.permissions.includes(permission);
    const next = has ? row.permissions.filter((p) => p !== permission) : [...row.permissions, permission];
    setBusyCell(`${row.id}:${permission}`);
    startTransition(async () => {
      const result = await saveBotAccessAction({
        id: row.id,
        telegramId: row.telegramId,
        displayName: row.displayName,
        note: row.note,
        permissions: next,
        isActive: row.isActive,
      });
      setBusyCell(null);
      if (!result.ok) toast("error", "Saqlanmadi", result.error);
    });
  }

  function remove(row: BotAccessRowView) {
    if (!window.confirm(`${row.displayName} (${row.telegramId}) ro‘yxatdan butunlay o‘chirilsinmi?\n\nBot unga hech qanday ruxsat bermaydi.`)) return;
    run(() => deleteBotAccessAction(row.id));
  }

  return (
    <div className="space-y-5">
      {warnings.length > 0 ? (
        <div className="space-y-2">
          {warnings.map((text) => (
            <p key={text} className="rounded-card border border-amber/50 bg-amber/10 px-4 py-3 text-sm text-ink">
              ⚠️ {text}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          {rows.length} ta ID · {active.length} ta faol
          {studioUsername ? (
            <>
              {" "}
              · Post Studio boti: <strong className="text-ink">@{studioUsername}</strong>
            </>
          ) : null}
        </p>
        <Button onClick={() => setDraft({ ...EMPTY })} disabled={pending}>
          <Plus className="h-4 w-4" aria-hidden /> Yangi ID qo‘shish
        </Button>
      </div>

      {draft ? (
        <Editor
          draft={draft}
          pending={pending}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => run(() => saveBotAccessAction(draft), () => setDraft(null))}
        />
      ) : null}

      {/* ------------------------------------------------ JADVAL: odam × funksiya */}
      <div className="overflow-x-auto rounded-card border border-line bg-card shadow-card">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th rowSpan={2} className="sticky left-0 z-10 bg-card px-4 py-3 text-left align-bottom text-xs font-bold uppercase tracking-wide text-ink-soft">
                Kim
              </th>
              {BOTS.map((bot) => (
                <th key={bot.key} colSpan={bot.functions.length} className="border-l border-line px-3 pt-3 text-left text-xs font-bold text-ink">
                  {bot.label}
                </th>
              ))}
              <th rowSpan={2} className="border-l border-line px-3 py-3 text-right align-bottom text-xs font-bold uppercase tracking-wide text-ink-soft">
                Amallar
              </th>
            </tr>
            <tr className="border-b border-line">
              {BOTS.flatMap((bot) =>
                bot.functions.map((fn, index) => (
                  <th
                    key={fn.key}
                    title={fn.hint}
                    className={cn("px-2 pb-3 pt-1 text-center align-bottom text-[11px] font-semibold leading-tight text-ink-soft", index === 0 && "border-l border-line")}
                  >
                    <span className="mx-auto mb-1 block w-fit text-ink-soft/70">
                      {fn.kind === "notify" ? <Bell className="h-3.5 w-3.5" aria-label="Bildirishnoma" /> : <MousePointerClick className="h-3.5 w-3.5" aria-label="Amal" />}
                    </span>
                    {fn.label}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={BOT_PERMISSIONS.length + 2} className="px-4 py-10 text-center text-ink-soft">
                  Hali hech kim yo‘q — “Yangi ID qo‘shish” tugmasini bosing.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id} className={cn("border-b border-line last:border-0", !row.isActive && "bg-surface/60 text-ink-soft")}>
                <td className="sticky left-0 z-10 bg-inherit px-4 py-3 align-top">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-ink">{row.displayName}</span>
                    {row.isActive ? <Badge accent="green">Faol</Badge> : <Badge accent="neutral">To‘xtatilgan</Badge>}
                  </div>
                  <code className="mt-0.5 block text-xs text-ink-soft">{row.telegramId}</code>
                  {row.note ? <p className="mt-1 max-w-[16rem] text-xs leading-snug text-ink-soft">{row.note}</p> : null}
                </td>
                {BOTS.flatMap((bot) =>
                  bot.functions.map((fn, index) => {
                    const checked = row.permissions.includes(fn.key);
                    const busy = busyCell === `${row.id}:${fn.key}`;
                    return (
                      <td key={fn.key} className={cn("px-2 py-3 text-center align-middle", index === 0 && "border-l border-line")}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={pending || busy}
                          onChange={() => toggleCell(row, fn.key)}
                          aria-label={`${row.displayName}: ${fn.label}`}
                          className="h-4 w-4 cursor-pointer accent-[var(--color-brand,#1677ff)] disabled:cursor-wait"
                        />
                      </td>
                    );
                  }),
                )}
                <td className="border-l border-line px-3 py-3 align-middle">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Tahrirlash"
                      onClick={() =>
                        setDraft({
                          id: row.id,
                          telegramId: row.telegramId,
                          displayName: row.displayName,
                          note: row.note,
                          permissions: cleanPermissions(row.permissions),
                          isActive: row.isActive,
                        })
                      }
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                      <span className="sr-only">Tahrirlash</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title={row.isActive ? "To‘xtatish" : "Faollashtirish"}
                      disabled={pending}
                      onClick={() => run(() => setBotAccessActiveAction(row.id, !row.isActive))}
                    >
                      <Power className={cn("h-4 w-4", row.isActive ? "text-green" : "text-ink-soft")} aria-hidden />
                      <span className="sr-only">{row.isActive ? "To‘xtatish" : "Faollashtirish"}</span>
                    </Button>
                    <Button variant="ghost" size="sm" title="O‘chirish" disabled={pending} onClick={() => remove(row)}>
                      <Trash2 className="h-4 w-4 text-coral" aria-hidden />
                      <span className="sr-only">O‘chirish</span>
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-ink-soft">
        <Bell className="mr-1 inline h-3.5 w-3.5" aria-hidden /> — bot o‘zi yuboradigan xabar;{" "}
        <MousePointerClick className="mx-1 inline h-3.5 w-3.5" aria-hidden /> — odam tugma yoki buyruq bilan ishlatadigan funksiya.
        Odam botga kamida bir marta <code>/start</code> yozgan bo‘lishi kerak — aks holda Telegram unga xabar yuborishga ruxsat bermaydi.
        Telegram ID’ni bilish uchun odam <code>@userinfobot</code> ga istalgan xabar yozadi.
      </p>
    </div>
  );
}

/* ========================================================================= *
 * TAHRIRLASH / QO'SHISH
 * ========================================================================= */

function Editor({
  draft,
  pending,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  pending: boolean;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const idCheck = draft.telegramId ? parseTelegramId(draft.telegramId) : null;
  const idError = idCheck && !idCheck.ok ? TELEGRAM_ID_PROBLEM_TEXT[idCheck.problem] : null;

  function toggle(permission: BotPermission) {
    const has = draft.permissions.includes(permission);
    onChange({
      ...draft,
      permissions: cleanPermissions(has ? draft.permissions.filter((p) => p !== permission) : [...draft.permissions, permission]),
    });
  }

  function setBot(keys: BotPermission[], on: boolean) {
    const rest = draft.permissions.filter((p) => !keys.includes(p));
    onChange({ ...draft, permissions: cleanPermissions(on ? [...rest, ...keys] : rest) });
  }

  return (
    <form
      className="rounded-card border border-brand/40 bg-card p-5 shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-ink">{draft.id ? "Tahrirlash" : "Yangi Telegram ID"}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-4 w-4" aria-hidden /> Bekor qilish
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="bot-access-id">Telegram ID</Label>
          <Input
            id="bot-access-id"
            inputMode="numeric"
            placeholder="masalan: 5072996465"
            value={draft.telegramId}
            onChange={(event) => onChange({ ...draft, telegramId: event.target.value })}
            required
          />
          {idError ? <p className="mt-1 text-xs text-coral">{idError}</p> : null}
        </div>
        <div>
          <Label htmlFor="bot-access-name">Ism</Label>
          <Input
            id="bot-access-name"
            placeholder="masalan: Bosh muharrir"
            maxLength={120}
            value={draft.displayName}
            onChange={(event) => onChange({ ...draft, displayName: event.target.value })}
            required
          />
        </div>
        <div>
          <Label htmlFor="bot-access-note">Izoh (ixtiyoriy)</Label>
          <Textarea
            id="bot-access-note"
            rows={1}
            maxLength={500}
            placeholder="Kim va nega"
            value={draft.note}
            onChange={(event) => onChange({ ...draft, note: event.target.value })}
          />
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {BOTS.map((bot) => {
          const keys = bot.functions.map((fn) => fn.key);
          const all = keys.every((key) => draft.permissions.includes(key));
          return (
            <fieldset key={bot.key} className="rounded-card border border-line p-4">
              <legend className="px-1 text-sm font-bold text-ink">{bot.label}</legend>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs text-ink-soft">{bot.description}</p>
                <button type="button" className="shrink-0 text-xs font-bold text-brand hover:underline" onClick={() => setBot(keys, !all)}>
                  {all ? "Hammasini olib tashlash" : "Hammasini belgilash"}
                </button>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {bot.functions.map((fn) => (
                  <li key={fn.key}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-[12px] border border-line px-3 py-2 hover:border-brand/40">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        checked={draft.permissions.includes(fn.key)}
                        onChange={() => toggle(fn.key)}
                      />
                      <span>
                        <span className="block text-sm font-semibold text-ink">{fn.label}</span>
                        <span className="block text-xs leading-snug text-ink-soft">{fn.hint}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="h-4 w-4" checked={draft.isActive} onChange={(event) => onChange({ ...draft, isActive: event.target.checked })} />
          Faol (o‘chirsangiz, ruxsatlar saqlanadi, lekin bot ularni bermaydi)
        </label>
        <Button type="submit" disabled={pending || Boolean(idError) || !draft.telegramId || !draft.displayName.trim()}>
          {draft.id ? "Saqlash" : "Qo‘shish"}
        </Button>
      </div>
    </form>
  );
}
