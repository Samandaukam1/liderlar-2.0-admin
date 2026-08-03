"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, UploadCloud } from "lucide-react";
import { Button, FormField, Input, Select, Textarea } from "@/components/ui/primitives";
import { Modal, ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import { uploadToBucket } from "@/lib/upload-client";
import {
  deleteContentAction,
  upsertContentAction,
  type ResourceKind,
} from "@/lib/actions/content";

export interface FieldSpec {
  name: string;
  label: string;
  type: "text" | "textarea" | "date" | "datetime" | "number" | "select" | "checkbox" | "upload";
  options?: Array<{ value: string; label: string }>;
  bucket?: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
}

function UploadField({
  name,
  bucket,
  initial,
}: {
  name: string;
  bucket: string;
  initial: string;
}) {
  const { toast } = useToast();
  const [url, setUrl] = useState(initial);
  const [uploading, setUploading] = useState(false);

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={url} />
      {url && /\.(jpe?g|png|webp)(\?|$)/i.test(url) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="aspect-video w-full rounded-[14px] border border-line object-cover" />
      )}
      {url && !/\.(jpe?g|png|webp)(\?|$)/i.test(url) && (
        <p className="truncate rounded-[12px] border border-line bg-surface px-3 py-2 text-xs text-ink-soft">{url}</p>
      )}
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[12px] border border-line px-3 py-2 text-xs font-bold text-ink-soft transition hover:border-brand/50 hover:text-brand">
        <UploadCloud className="h-3.5 w-3.5" />
        {uploading ? "Yuklanmoqda…" : url ? "Almashtirish" : "Fayl yuklash"}
        <input
          type="file"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setUploading(true);
            try {
              setUrl(await uploadToBucket(f, bucket));
              toast("success", "Fayl yuklandi");
            } catch (err) {
              toast("error", "Yuklab bo‘lmadi", err instanceof Error ? err.message : undefined);
            } finally {
              setUploading(false);
            }
          }}
        />
      </label>
    </div>
  );
}

export function ResourceFormModal({
  kind,
  title,
  fields,
  record,
  trigger = "button",
  triggerLabel,
}: {
  kind: ResourceKind;
  title: string;
  fields: FieldSpec[];
  /** null → create form */
  record: (Record<string, unknown> & { id: string }) | null;
  trigger?: "button" | "icon";
  triggerLabel?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const value = (name: string) => {
    const v = record?.[name];
    if (v == null) return "";
    return String(v);
  };

  return (
    <>
      {trigger === "button" ? (
        <Button size="sm" variant={record ? "secondary" : "primary"} onClick={() => setOpen(true)}>
          {record ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {triggerLabel ?? (record ? "Tahrirlash" : "Qo‘shish")}
        </Button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="Tahrirlash"
          className="rounded-lg p-1.5 text-ink-soft transition hover:bg-brand/10 hover:text-brand"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={title} wide={fields.length > 5}>
        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await upsertContentAction(kind, record?.id ?? null, fd);
              if (res.ok) {
                toast("success", record ? "Saqlandi" : "Yaratildi");
                setOpen(false);
                router.refresh();
              } else toast("error", "Xatolik", res.error);
            })
          }
          className={fields.length > 5 ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "space-y-4"}
        >
          {fields.map((f) => (
            <div key={f.name} className={f.type === "textarea" ? "sm:col-span-2" : undefined}>
              {f.type === "checkbox" ? (
                <label className="flex items-center gap-2 pt-5 text-sm font-semibold text-ink">
                  <input
                    type="checkbox"
                    name={f.name}
                    value="true"
                    defaultChecked={record?.[f.name] === true}
                    className="h-4 w-4 rounded accent-[#087ea4]"
                  />
                  {f.label}
                </label>
              ) : (
                <FormField label={f.label} htmlFor={`${kind}-${f.name}`} hint={f.hint}>
                  {f.type === "textarea" ? (
                    <Textarea
                      id={`${kind}-${f.name}`}
                      name={f.name}
                      rows={3}
                      defaultValue={value(f.name)}
                      required={f.required}
                      placeholder={f.placeholder}
                    />
                  ) : f.type === "select" ? (
                    <Select id={`${kind}-${f.name}`} name={f.name} defaultValue={value(f.name)}>
                      {!f.required && <option value="">—</option>}
                      {(f.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : f.type === "upload" ? (
                    <UploadField name={f.name} bucket={f.bucket ?? "admin-private-files"} initial={value(f.name)} />
                  ) : (
                    <Input
                      id={`${kind}-${f.name}`}
                      name={f.name}
                      type={f.type === "datetime" ? "datetime-local" : f.type}
                      defaultValue={
                        f.type === "datetime" ? value(f.name).slice(0, 16) : value(f.name)
                      }
                      required={f.required}
                      placeholder={f.placeholder}
                    />
                  )}
                </FormField>
              )}
            </div>
          ))}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saqlanmoqda…" : record ? "Saqlash" : "Yaratish"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ResourceDeleteButton({
  kind,
  id,
  label,
}: {
  kind: ResourceKind;
  id: string;
  label: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        onClick={() => setConfirm(true)}
        aria-label="O‘chirish"
        className="rounded-lg p-1.5 text-ink-soft transition hover:bg-coral/10 hover:text-coral"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          startTransition(async () => {
            const res = await deleteContentAction(kind, id);
            if (res.ok) {
              toast("success", "O‘chirildi");
              router.refresh();
            } else toast("error", "Xatolik", res.error);
          });
        }}
        title={`${label} o‘chirilsinmi?`}
        description="Bu amalni ortga qaytarib bo‘lmaydi."
        confirmLabel="O‘chirish"
        danger
        loading={pending}
      />
    </>
  );
}
