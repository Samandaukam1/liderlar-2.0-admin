"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, Plus, RotateCcw, Timer, XCircle } from "lucide-react";
import { Button, FormField, Select, Input } from "@/components/ui/primitives";
import { Modal, ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import {
  bulkCreateTokensAction,
  createTokenAction,
  extendTokenAction,
  revokeTokenAction,
  type TokenCreated,
} from "@/lib/actions/monthly";
import { formatDate } from "@/lib/utils";

function CopyButton({ text, label }: { text: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toast("success", `${label} nusxalandi`);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <Check className="h-4 w-4 text-green" /> : <Copy className="h-4 w-4" />}
      {label}
    </Button>
  );
}

function TokenResult({ result }: { result: TokenCreated }) {
  if (!result.link) return null;
  return (
    <div className="space-y-3">
      <p className="rounded-[14px] border border-peach/50 bg-peach/10 px-3.5 py-2.5 text-xs font-semibold text-[#b3611f]">
        Diqqat: bu havola faqat HOZIR ko‘rsatiladi. Bazada faqat hash saqlanadi —
        yopilgandan so‘ng qayta ko‘rib bo‘lmaydi.
      </p>
      <div className="break-all rounded-[14px] border border-line bg-surface p-3 font-mono text-xs text-ink">
        {result.link}
      </div>
      <p className="text-xs text-ink-soft">
        Amal qilish muddati: <b className="text-ink">{formatDate(result.expiresAt, true)}</b>
      </p>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={result.link} label="Havolani nusxalash" />
        {result.telegramMessage && (
          <CopyButton text={result.telegramMessage} label="Telegram xabari" />
        )}
      </div>
    </div>
  );
}

export function CreateTokenButton({
  candidates,
  preselectedId,
}: {
  candidates: Array<{ id: string; full_name: string }>;
  preselectedId?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(Boolean(preselectedId));
  const [candidateId, setCandidateId] = useState(preselectedId ?? "");
  const [ttl, setTtl] = useState("14");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TokenCreated | null>(null);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Havola yaratish
      </Button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setResult(null);
          if (result) router.refresh();
        }}
        title={result ? "Havola tayyor" : "Oylik yangilash havolasi"}
      >
        {result ? (
          <TokenResult result={result} />
        ) : (
          <div className="space-y-4">
            <FormField label="Nomzod" htmlFor="token-candidate">
              <Select
                id="token-candidate"
                value={candidateId}
                onChange={(e) => setCandidateId(e.target.value)}
              >
                <option value="">Tanlang…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Amal qilish muddati (kun)" htmlFor="token-ttl">
              <Input
                id="token-ttl"
                type="number"
                min={1}
                max={90}
                value={ttl}
                onChange={(e) => setTtl(e.target.value)}
              />
            </FormField>
            <p className="text-xs text-ink-soft">
              Yangi havola yaratilganda nomzodning avvalgi faol havolasi avtomatik
              bekor qilinadi.
            </p>
            <div className="flex justify-end">
              <Button
                disabled={!candidateId || pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await createTokenAction(candidateId, parseInt(ttl, 10) || 14);
                    if (res.ok) setResult(res);
                    else toast("error", "Xatolik", res.error);
                  })
                }
              >
                <Link2 className="h-4 w-4" />
                {pending ? "Yaratilmoqda…" : "Yaratish"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export function BulkTokensButton({ candidateIds }: { candidateIds: string[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [tokens, setTokens] = useState<
    Array<{ candidateName: string; link: string; telegramMessage: string }> | null
  >(null);

  if (candidateIds.length === 0) return null;

  return (
    <>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await bulkCreateTokensAction(candidateIds);
            if (res.ok && res.tokens) setTokens(res.tokens);
            else toast("error", "Xatolik", res.error);
          })
        }
      >
        <Link2 className="h-4 w-4" />
        {pending
          ? "Yaratilmoqda…"
          : `Barchasiga havola yaratish (${candidateIds.length})`}
      </Button>
      <Modal
        open={tokens !== null}
        onClose={() => {
          setTokens(null);
          router.refresh();
        }}
        title="Ommaviy havolalar tayyor"
        wide
      >
        <p className="mb-3 rounded-[14px] border border-peach/50 bg-peach/10 px-3.5 py-2.5 text-xs font-semibold text-[#b3611f]">
          Havolalar faqat hozir ko‘rsatiladi — yuborishdan oldin nusxalab oling.
        </p>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {(tokens ?? []).map((t, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-[14px] border border-line p-3"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                {t.candidateName}
              </span>
              <CopyButton text={t.link} label="Havola" />
              <CopyButton text={t.telegramMessage} label="Telegram" />
            </div>
          ))}
        </div>
        {tokens && tokens.length > 0 && (
          <div className="mt-3 flex justify-end">
            <CopyButton
              text={tokens.map((t) => `${t.candidateName}:\n${t.link}`).join("\n\n")}
              label="Hammasini nusxalash"
            />
          </div>
        )}
      </Modal>
    </>
  );
}

export function TokenRowActions({
  tokenId,
  candidateId,
  status,
}: {
  tokenId: string;
  candidateId: string;
  status: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [reissued, setReissued] = useState<TokenCreated | null>(null);

  return (
    <div className="flex items-center justify-end gap-1">
      {status === "active" && (
        <button
          title="Muddatini 7 kunga uzaytirish"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await extendTokenAction(tokenId, 7);
              if (res.ok) {
                toast("success", "Muddat 7 kunga uzaytirildi");
                router.refresh();
              } else toast("error", "Xatolik", res.error);
            })
          }
          className="rounded-lg p-1.5 text-ink-soft transition hover:bg-cyan/10 hover:text-brand"
        >
          <Timer className="h-4 w-4" />
        </button>
      )}
      <button
        title="Qayta yaratish"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await createTokenAction(candidateId);
            if (res.ok) setReissued(res);
            else toast("error", "Xatolik", res.error);
          })
        }
        className="rounded-lg p-1.5 text-ink-soft transition hover:bg-lavender/15 hover:text-[#6a52c7]"
      >
        <RotateCcw className="h-4 w-4" />
      </button>
      {status === "active" && (
        <button
          title="Bekor qilish"
          disabled={pending}
          onClick={() => setConfirmRevoke(true)}
          className="rounded-lg p-1.5 text-ink-soft transition hover:bg-coral/10 hover:text-coral"
        >
          <XCircle className="h-4 w-4" />
        </button>
      )}

      <ConfirmDialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={() => {
          setConfirmRevoke(false);
          startTransition(async () => {
            const res = await revokeTokenAction(tokenId);
            if (res.ok) {
              toast("success", "Token bekor qilindi");
              router.refresh();
            } else toast("error", "Xatolik", res.error);
          });
        }}
        title="Tokenni bekor qilish"
        description="Nomzod bu havola orqali endi ma’lumot yubora olmaydi."
        confirmLabel="Bekor qilish"
        danger
      />

      <Modal
        open={reissued !== null}
        onClose={() => {
          setReissued(null);
          router.refresh();
        }}
        title="Yangi havola tayyor"
      >
        {reissued && <TokenResult result={reissued} />}
      </Modal>
    </div>
  );
}
