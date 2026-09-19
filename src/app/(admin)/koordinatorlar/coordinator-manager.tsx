"use client";

import * as React from "react";
import { useTransition } from "react";
import { Button, Input, Label, Textarea } from "@/components/ui/primitives";
import { Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
  createCoordinatorAction,
  deactivateCoordinatorAction,
  setCoordinatorStatusAction,
  setRoutingEnabledAction,
  setDailyTargetAction,
  updateCoordinatorAction,
} from "@/lib/actions/coordinators";

export interface CoordinatorRow {
  id: string;
  fullName: string;
  photoUrl: string | null;
  regionId: string | null;
  regionName: string | null;
  phone: string | null;
  publicPhone: string | null;
  showPhonePublicly: boolean;
  publicEmail: string | null;
  bio: string | null;
  /** Bot bilan bog'langanmi — RAQAMNING O'ZI ko'rsatilmaydi. */
  hasTelegram: boolean;
  telegramUsername: string | null;
  status: string;
  backupPriority: number;
  dailyLeadLimit: number | null;
  isActive: boolean;
}

export interface RegionOption {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Faol",
  paused: "Pauzada",
  offline: "Oflayn",
  suspended: "To‘xtatilgan",
};

export function CoordinatorManager({
  coordinators,
  regions,
  routingEnabled,
  defaultTarget,
}: {
  coordinators: CoordinatorRow[];
  regions: RegionOption[];
  routingEnabled: boolean;
  defaultTarget: number;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<CoordinatorRow | null>(null);
  const [adding, setAdding] = React.useState(false);

  return (
    <div className="space-y-4">
      {/* --- Marshrutlash va talab --- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RoutingControl enabled={routingEnabled} />
        <TargetControl defaultTarget={defaultTarget} />
      </div>

      {/* --- Ro'yxat --- */}
      <section className="rounded-card border border-line bg-card p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-ink">Koordinatorlar</h2>
          <Button
            type="button"
            onClick={() => {
              setEditing(null);
              setAdding((v) => !v);
            }}
          >
            {adding ? "Bekor qilish" : "+ Koordinator qo‘shish"}
          </Button>
        </div>

        {adding ? (
          <CoordinatorForm
            regions={regions}
            onDone={() => setAdding(false)}
            onToast={toast}
          />
        ) : null}

        {coordinators.length === 0 && !adding ? (
          <p className="text-sm text-ink-soft">
            Hali koordinator yo‘q. Marshrutlashni yoqish uchun kamida bittasi kerak.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {coordinators.map((c) => (
              <li key={c.id} className="py-3">
                {editing?.id === c.id ? (
                  <CoordinatorForm
                    regions={regions}
                    initial={c}
                    onDone={() => setEditing(null)}
                    onToast={toast}
                  />
                ) : (
                  <CoordinatorRowView
                    coordinator={c}
                    onEdit={() => {
                      setAdding(false);
                      setEditing(c);
                    }}
                    onToast={toast}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ qatordagi ko'rinish ---------------------- */

function CoordinatorRowView({
  coordinator,
  onEdit,
  onToast,
}: {
  coordinator: CoordinatorRow;
  onEdit: () => void;
  onToast: (kind: "success" | "error", title: string, body?: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  const run = (action: (fd: FormData) => Promise<{ ok: boolean; message?: string; error?: string }>, fd: FormData) =>
    startTransition(async () => {
      const result = await action(fd);
      if (result.ok) onToast("success", "Bajarildi", result.message);
      else onToast("error", "Bajarilmadi", result.error);
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      {coordinator.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coordinator.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
      ) : (
        <span className="h-10 w-10 rounded-full bg-surface" aria-hidden />
      )}

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-ink">{coordinator.fullName}</span>
        <span className="block text-xs text-ink-soft">
          {coordinator.regionName ?? "hudud biriktirilmagan"} · {STATUS_LABELS[coordinator.status]}
          {coordinator.dailyLeadLimit ? ` · kuniga ${coordinator.dailyLeadLimit} ta` : ""}
        </span>
      </span>

      {/*
        BOT HOLATI — raqamning O'ZI ko'rsatilmaydi.
        Telegram id ichki identifikator; uni panelda ko'rsatish
        keraksiz va u ekran surati orqali tarqalishi mumkin.
      */}
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
          coordinator.hasTelegram ? "bg-mint/20 text-ink" : "bg-coral/15 text-ink"
        }`}
      >
        {coordinator.hasTelegram ? "Bot bilan bog‘langan" : "Bot bilan bog‘lanmagan"}
      </span>

      <span className="flex gap-1.5">
        <Button type="button" variant="ghost" onClick={onEdit} disabled={pending}>
          Tahrirlash
        </Button>
        {coordinator.status === "active" ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              const fd = new FormData();
              fd.set("id", coordinator.id);
              fd.set("status", "paused");
              run(setCoordinatorStatusAction, fd);
            }}
          >
            Pauza
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              const fd = new FormData();
              fd.set("id", coordinator.id);
              fd.set("status", "active");
              run(setCoordinatorStatusAction, fd);
            }}
          >
            Faollashtirish
          </Button>
        )}
        <Button
          type="button"
          variant="danger"
          disabled={pending}
          onClick={() => {
            const fd = new FormData();
            fd.set("id", coordinator.id);
            run(deactivateCoordinatorAction, fd);
          }}
        >
          Deaktivatsiya
        </Button>
      </span>
    </div>
  );
}

/* --------------------------------- forma --------------------------------- */

function CoordinatorForm({
  regions,
  initial,
  onDone,
  onToast,
}: {
  regions: RegionOption[];
  initial?: CoordinatorRow;
  onDone: () => void;
  onToast: (kind: "success" | "error", title: string, body?: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [showPhone, setShowPhone] = React.useState(initial?.showPhonePublicly ?? false);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = initial
        ? await updateCoordinatorAction(formData)
        : await createCoordinatorAction(formData);
      if (result.ok) {
        onToast("success", "Saqlandi", result.message);
        onDone();
      } else {
        onToast("error", "Saqlanmadi", result.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="my-3 rounded-card border border-line bg-surface p-4">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="fullName">F.I.Sh. *</Label>
          <Input id="fullName" name="fullName" defaultValue={initial?.fullName ?? ""} required />
        </div>
        <div>
          <Label htmlFor="regionId">Hudud *</Label>
          <Select id="regionId" name="regionId" defaultValue={initial?.regionId ?? ""} required>
            <option value="" disabled>
              Hududni tanlang
            </option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="photoUrl">Rasm havolasi</Label>
          <Input id="photoUrl" name="photoUrl" defaultValue={initial?.photoUrl ?? ""} />
        </div>
        <div>
          <Label htmlFor="telegramUserId">Telegram ID (raqam)</Label>
          <Input
            id="telegramUserId"
            name="telegramUserId"
            inputMode="numeric"
            placeholder={initial?.hasTelegram ? "o‘zgartirish uchun yozing" : "masalan 123456789"}
          />
          {/* Raqamli id asosiy identifikator: username qo'ldan
              qo'lga o'tadi, id esa o'zgarmaydi. */}
          <p className="mt-1 text-[11px] text-ink-soft">
            Asosiy identifikator. Username emas — u o‘zgarishi mumkin.
            {initial?.hasTelegram ? " Bo‘sh qoldirilsa mavjudi o‘chadi." : ""}
          </p>
        </div>

        <div>
          <Label htmlFor="telegramUsername">Telegram username</Label>
          <Input
            id="telegramUsername"
            name="telegramUsername"
            defaultValue={initial?.telegramUsername ?? ""}
            placeholder="@username"
          />
        </div>
        <div>
          <Label htmlFor="status">Holat</Label>
          <Select id="status" name="status" defaultValue={initial?.status ?? "active"}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="phone">Ichki telefon</Label>
          <Input id="phone" name="phone" defaultValue={initial?.phone ?? ""} />
          <p className="mt-1 text-[11px] text-ink-soft">Ommaviy saytda ko‘rinmaydi.</p>
        </div>
        <div>
          <Label htmlFor="publicPhone">Ommaviy telefon</Label>
          <Input id="publicPhone" name="publicPhone" defaultValue={initial?.publicPhone ?? ""} />
          <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-soft">
            <input
              type="checkbox"
              name="showPhonePublicly"
              checked={showPhone}
              onChange={(e) => setShowPhone(e.target.checked)}
              className="h-4 w-4"
            />
            Saytda ko‘rsatilsin
          </label>
        </div>

        <div>
          <Label htmlFor="publicEmail">Ommaviy email</Label>
          <Input id="publicEmail" name="publicEmail" defaultValue={initial?.publicEmail ?? ""} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="backupPriority">Ustuvorlik</Label>
            <Input
              id="backupPriority"
              name="backupPriority"
              type="number"
              min={0}
              max={9999}
              defaultValue={initial?.backupPriority ?? 100}
            />
            <p className="mt-1 text-[11px] text-ink-soft">Kichikroq — oldin.</p>
          </div>
          <div>
            <Label htmlFor="dailyLeadLimit">Kunlik chegara</Label>
            <Input
              id="dailyLeadLimit"
              name="dailyLeadLimit"
              type="number"
              min={1}
              max={1000}
              defaultValue={initial?.dailyLeadLimit ?? ""}
              placeholder="cheklovsiz"
            />
          </div>
        </div>
      </div>

      <div className="mt-3">
        <Label htmlFor="bio">Qisqa ma’lumot (ommaviy)</Label>
        <Textarea id="bio" name="bio" rows={2} defaultValue={initial?.bio ?? ""} />
      </div>
      <div className="mt-3">
        <Label htmlFor="notes">Ichki izoh</Label>
        <Textarea id="notes" name="notes" rows={2} placeholder="Saytda ko‘rinmaydi" />
      </div>

      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saqlanmoqda…" : initial ? "Saqlash" : "Qo‘shish"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Bekor qilish
        </Button>
      </div>
    </form>
  );
}

/* ----------------------------- marshrutlash ------------------------------ */

function RoutingControl({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("enabled", String(next));
      const result = await setRoutingEnabledAction(fd);
      if (result.ok) toast("success", "Bajarildi", result.message);
      else toast("error", "Bajarilmadi", result.error);
    });
  }

  return (
    <div className="rounded-card border border-line bg-card p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-ink">Marshrutlash</h2>
      <p className="mt-1 mb-3 text-xs leading-relaxed text-ink-soft">
        Yoqilganda yangi arizalar hududiy koordinatorga yuboriladi.
        Deploy uni o‘zi yoqmaydi — bu aniq harakat.
      </p>
      <Button
        type="button"
        variant={enabled ? "danger" : "primary"}
        disabled={pending}
        onClick={() => toggle(!enabled)}
      >
        {pending ? "…" : enabled ? "Marshrutlashni to‘xtatish" : "Marshrutlashni yoqish"}
      </Button>
    </div>
  );
}

function TargetControl({ defaultTarget }: { defaultTarget: number }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await setDailyTargetAction(formData);
      if (result.ok) toast("success", "Saqlandi", result.message);
      else toast("error", "Saqlanmadi", result.error);
    });
  }

  return (
    <form action={onSubmit} className="rounded-card border border-line bg-card p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-ink">Kunlik talabni belgilash</h2>
      <p className="mt-1 mb-3 text-xs leading-relaxed text-ink-soft">
        Tasdiqlangan sotuvlar soni. Sana kiritilsa — faqat o‘sha kun uchun;
        bo‘sh qoldirilsa — standart qiymat. Tarix qayta baholanmaydi.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="target">Talab</Label>
          <Input id="target" name="target" type="number" min={0} max={10000} defaultValue={defaultTarget} />
        </div>
        <div>
          <Label htmlFor="date">Sana (ixtiyoriy)</Label>
          <Input id="date" name="date" type="date" />
        </div>
      </div>
      <div className="mt-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saqlanmoqda…" : "Saqlash"}
        </Button>
      </div>
    </form>
  );
}
