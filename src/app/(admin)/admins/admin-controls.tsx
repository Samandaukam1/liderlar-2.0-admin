"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, ShieldCheck, UserPlus, UserX } from "lucide-react";
import { Button, FormField, Input, Select } from "@/components/ui/primitives";
import { Modal, ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import {
  inviteAdminAction,
  setAdminActiveAction,
  setAdminRolesAction,
} from "@/lib/actions/admins";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/permissions";

export function InviteAdminButton() {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" /> Admin taklif qilish
      </Button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setTempPassword(null);
          router.refresh();
        }}
        title={tempPassword ? "Admin yaratildi" : "Yangi admin"}
      >
        {tempPassword ? (
          <div className="space-y-3">
            <p className="rounded-[14px] border border-peach/50 bg-peach/10 px-3.5 py-2.5 text-xs font-semibold text-[#b3611f]">
              Vaqtinchalik parol faqat HOZIR ko‘rsatiladi. Adminга xavfsiz kanal
              orqali yuboring — u birinchi kirishdan so‘ng parolni o‘zgartirishi kerak.
            </p>
            <div className="flex items-center gap-2 rounded-[14px] border border-line bg-surface p-3 font-mono text-sm">
              <span className="flex-1">{tempPassword}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(tempPassword);
                  toast("success", "Parol nusxalandi");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <form
            action={(fd) =>
              startTransition(async () => {
                const res = await inviteAdminAction(fd);
                if (res.ok && res.tempPassword) setTempPassword(res.tempPassword);
                else toast("error", "Xatolik", res.error);
              })
            }
            className="space-y-4"
          >
            <FormField label="To‘liq ism" htmlFor="inv-name">
              <Input id="inv-name" name="full_name" required minLength={3} />
            </FormField>
            <FormField label="Email" htmlFor="inv-email">
              <Input id="inv-email" name="email" type="email" required />
            </FormField>
            <FormField label="Rol" htmlFor="inv-role">
              <Select id="inv-role" name="role" defaultValue="viewer">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? "Yaratilmoqda…" : "Yaratish"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

export function AdminRowControls({
  userId,
  fullName,
  roles,
  isActive,
  isSelf,
}: {
  userId: string;
  fullName: string;
  roles: string[];
  isActive: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rolesOpen, setRolesOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(roles));
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        title="Rollarni o‘zgartirish"
        onClick={() => {
          setSelected(new Set(roles));
          setRolesOpen(true);
        }}
        className="rounded-lg p-1.5 text-ink-soft transition hover:bg-cyan/10 hover:text-brand"
      >
        <ShieldCheck className="h-4 w-4" />
      </button>
      {!isSelf && (
        <button
          title={isActive ? "Bloklash" : "Faollashtirish"}
          onClick={() => setConfirmToggle(true)}
          className="rounded-lg p-1.5 text-ink-soft transition hover:bg-coral/10 hover:text-coral"
        >
          <UserX className="h-4 w-4" />
        </button>
      )}

      <Modal open={rolesOpen} onClose={() => setRolesOpen(false)} title={`${fullName} — rollar`}>
        <div className="space-y-2">
          {ROLES.map((r) => (
            <label
              key={r}
              className="flex cursor-pointer items-center gap-3 rounded-[14px] border border-line p-3 transition hover:border-brand/40"
            >
              <input
                type="checkbox"
                checked={selected.has(r)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(r);
                  else next.delete(r);
                  setSelected(next);
                }}
                className="h-4 w-4 rounded accent-[#087ea4]"
              />
              <span className="text-sm font-bold text-ink">{ROLE_LABELS[r]}</span>
              <code className="ml-auto text-[11px] text-ink-soft">{r}</code>
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRolesOpen(false)}>
            Bekor qilish
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await setAdminRolesAction(userId, Array.from(selected) as Role[]);
                if (res.ok) {
                  toast("success", "Rollar yangilandi");
                  setRolesOpen(false);
                  router.refresh();
                } else toast("error", "Xatolik", res.error);
              })
            }
          >
            {pending ? "Saqlanmoqda…" : "Saqlash"}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmToggle}
        onClose={() => setConfirmToggle(false)}
        onConfirm={() => {
          setConfirmToggle(false);
          startTransition(async () => {
            const res = await setAdminActiveAction(userId, !isActive);
            if (res.ok) {
              toast("success", isActive ? "Admin bloklandi" : "Admin faollashtirildi");
              router.refresh();
            } else toast("error", "Xatolik", res.error);
          });
        }}
        title={isActive ? "Adminni bloklash" : "Adminni faollashtirish"}
        description={
          isActive
            ? `${fullName} admin panelga kira olmay qoladi.`
            : `${fullName} yana admin panelga kira oladi.`
        }
        confirmLabel={isActive ? "Bloklash" : "Faollashtirish"}
        danger={isActive}
      />
    </div>
  );
}
