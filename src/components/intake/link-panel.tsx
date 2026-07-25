"use client";

import { useState, useTransition } from "react";
import { Link2, Copy, Check, RefreshCw, TimerReset, Ban, ShieldAlert } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { Badge } from "@/components/admin/badges";
import { useToast } from "@/components/ui/toast";
import { daysUntil, formatDate } from "@/lib/utils";
import { regenerateLinkAction, revokeLinkAction, extendLinkAction } from "@/lib/actions/intakes";

export function LinkPanel({
  intakeId,
  link,
}: {
  intakeId: string;
  link: { prefix: string; expiresAt: string } | null;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [reveal, setReveal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const days = link ? daysUntil(link.expiresAt) : null;
  const active = link && days != null && days >= 0;

  const copy = async () => {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.toast("error", "Nusxalab bo‘lmadi");
    }
  };

  const regenerate = () =>
    startTransition(async () => {
      const r = await regenerateLinkAction(intakeId);
      if (r.ok && r.link) {
        setReveal(r.link);
        toast.toast("success", "Yangi havola yaratildi");
      } else toast.toast("error", "Xatolik", r.error);
    });

  const extend = () =>
    startTransition(async () => {
      const r = await extendLinkAction(intakeId);
      if (r.ok) toast.toast("success", "Muddat uzaytirildi");
      else toast.toast("error", "Xatolik", r.error);
    });

  const revoke = () =>
    startTransition(async () => {
      const r = await revokeLinkAction(intakeId);
      if (r.ok) toast.toast("success", "Havola bekor qilindi");
      else toast.toast("error", "Xatolik", r.error);
    });

  return (
    <Card>
      <h3 className="mb-3 flex items-center gap-2 font-bold text-ink">
        <Link2 className="h-4 w-4 text-brand" /> Xavfsiz havola
      </h3>

      <div className="mb-3 flex items-center justify-between rounded-field border border-line bg-surface/50 p-3">
        <div>
          <p className="text-xs text-ink-soft">Holat</p>
          {active ? (
            <Badge accent={days! <= 5 ? "peach" : "cyan"}>{days} kun qoldi</Badge>
          ) : (
            <Badge accent="coral">Faol emas</Badge>
          )}
        </div>
        {link && (
          <div className="text-right">
            <p className="text-xs text-ink-soft">Muddat</p>
            <p className="text-xs font-semibold text-ink">{formatDate(link.expiresAt)}</p>
          </div>
        )}
      </div>

      {reveal && (
        <div className="mb-3">
          <div className="flex items-center gap-2 rounded-field border border-line bg-surface/60 p-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-1 text-xs text-ink">{reveal}</code>
            <Button size="sm" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Bu havola faqat hozir ko‘rsatiladi. Nusxalab, nomzodga xavfsiz yuboring va boshqa shaxsga bermang.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        <Button variant="secondary" size="sm" onClick={regenerate} disabled={pending}>
          <RefreshCw className="h-3.5 w-3.5" /> Qayta yaratish
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" size="sm" onClick={extend} disabled={pending || !active}>
            <TimerReset className="h-3.5 w-3.5" /> Uzaytirish
          </Button>
          <Button variant="ghost" size="sm" onClick={revoke} disabled={pending || !active}>
            <Ban className="h-3.5 w-3.5" /> Bekor qilish
          </Button>
        </div>
      </div>
    </Card>
  );
}
