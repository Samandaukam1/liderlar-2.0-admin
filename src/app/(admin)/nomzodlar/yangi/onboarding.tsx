"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PencilLine,
  Link2,
  Copy,
  Check,
  ShieldAlert,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { Button, Input, FormField, Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { createManualIntakeAction, createSecureLinkIntakeAction } from "@/lib/actions/intakes";

type Method = "manual" | "secure_link";

const CARDS: { key: Method; title: string; desc: string; icon: typeof PencilLine; accent: string }[] = [
  {
    key: "manual",
    title: "Qo‘lda kiritish",
    desc: "Anketani admin panel ichida nomzod nomidan bosqichma-bosqich to‘ldiring. Autosave va AI review qo‘llab-quvvatlanadi.",
    icon: PencilLine,
    accent: "from-brand/12 to-cyan/12 text-brand",
  },
  {
    key: "secure_link",
    title: "Maxsus sinxronlanadigan havola",
    desc: "Nomzodga xavfsiz, muddatli havola yarating. U o‘zi to‘ldiradi, javoblar real vaqtda sinxronlanadi.",
    icon: Link2,
    accent: "from-lavender/15 to-cyan/12 text-electric",
  },
];

export function IntakeOnboarding() {
  const router = useRouter();
  const toast = useToast();
  const [method, setMethod] = useState<Method | null>(null);
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<"male" | "female" | null>(null);
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<{ url: string; id: string; expiresAt?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const buildFd = () => {
    const fd = new FormData();
    fd.set("full_name", fullName);
    fd.set("gender", gender ?? "");
    return fd;
  };

  const canSubmit = fullName.trim().length >= 3 && !!gender;

  const handleSubmit = () => {
    if (!method || !canSubmit) return;
    startTransition(async () => {
      if (method === "manual") {
        const res = await createManualIntakeAction(buildFd());
        if (res.ok && res.id) {
          toast.toast("success", "Anketa yaratildi", "Endi savollarni to‘ldiring");
          router.push(`/nomzodlar/anketalar/${res.id}`);
        } else {
          toast.toast("error", "Xatolik", res.error);
        }
      } else {
        const res = await createSecureLinkIntakeAction(buildFd());
        if (res.ok && res.link && res.id) {
          setLink({ url: res.link, id: res.id, expiresAt: res.expiresAt });
        } else {
          toast.toast("error", "Xatolik", res.error);
        }
      }
    });
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.toast("error", "Nusxalab bo‘lmadi");
    }
  };

  // Secure-link reveal (shown exactly once).
  if (link) {
    return (
      <Card className="mx-auto max-w-2xl">
        <div className="text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-mint/20 text-green">
            <Check className="h-7 w-7" />
          </span>
          <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-ink">Havola tayyor</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Bu havola faqat bir marta ko‘rsatiladi. Uni nusxalab, nomzodga xavfsiz kanal orqali yuboring.
          </p>
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-field border border-line bg-surface/60 p-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2 text-sm text-ink">{link.url}</code>
          <Button size="sm" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Nusxalandi" : "Nusxalash"}
          </Button>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-field border border-peach/50 bg-peach/10 p-3 text-sm text-amber">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Havolani boshqa shaxsga bermang. U 30 kun amal qiladi. Kerak bo‘lsa keyinroq bekor qilishingiz yoki
            qayta yaratishingiz mumkin.
          </span>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => router.push("/nomzodlar/anketalar")}>
            Ro‘yxatga qaytish
          </Button>
          <Button onClick={() => router.push(`/nomzodlar/anketalar/${link.id}`)}>
            Anketani ko‘rish <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* Method cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((c) => {
          const Icon = c.icon;
          const active = method === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setMethod(c.key)}
              className={cn(
                "group rounded-card border bg-card p-6 text-left shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover",
                active ? "border-brand ring-2 ring-brand/25" : "border-line",
              )}
            >
              <span className={cn("mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br", c.accent)}>
                <Icon className="h-6 w-6" />
              </span>
              <h3 className="text-base font-bold text-ink">{c.title}</h3>
              <p className="mt-1.5 text-sm text-ink-soft">{c.desc}</p>
              {active && (
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-brand">
                  Tanlandi <Check className="h-3.5 w-3.5" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Name + gender form */}
      {method && (
        <Card className="mt-6 rise-in">
          <FormField label="Ism familiya (yoki Ism Familiya Otasining ismi)" htmlFor="full_name">
            <Input
              id="full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Masalan: Aziza Karimova Akmalovna"
            />
          </FormField>

          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Jins</p>
            <div className="flex gap-2">
              {(["male", "female"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(g)}
                  className={cn(
                    "flex-1 rounded-field border px-4 py-2.5 text-sm font-bold transition",
                    gender === g
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-line text-ink-soft hover:border-brand/40 hover:text-ink",
                  )}
                >
                  {g === "male" ? "Erkak" : "Ayol"}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <Button variant="ghost" onClick={() => setMethod(null)}>
              <ArrowLeft className="h-4 w-4" /> Usulni o‘zgartirish
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {method === "manual" ? "Anketani boshlash" : "Havola yaratish"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
