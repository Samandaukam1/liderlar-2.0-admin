"use client";

import { useState, type ChangeEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { FormField, Input, Textarea } from "@/components/ui/primitives";
import { splitPipeValues } from "@/lib/candidates/parser";

export function PipeValuesField({
  id,
  label,
  hint,
  placeholder,
  values,
  onChange,
  multiline = false,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
  multiline?: boolean;
}) {
  const valuesKey = JSON.stringify(values);
  const [draft, setDraft] = useState(() => ({ key: valuesKey, text: values.join(" | ") }));

  // AI/parsing can replace these values. Our own updates already carry the
  // same key, so ordinary typing keeps spaces, delimiters and the caret intact.
  if (draft.key !== valuesKey) {
    setDraft({ key: valuesKey, text: values.join(" | ") });
  }

  const changeText = (text: string) => {
    const next = splitPipeValues(text);
    setDraft({ key: JSON.stringify(next), text });
    onChange(next);
  };

  const editItem = (item: string) => {
    const field = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!field) return;
    let offset = 0;
    for (const part of draft.text.split("|")) {
      if (part.trim() === item) {
        const start = offset + part.indexOf(item);
        field.focus();
        field.setSelectionRange(start, start + item.length);
        return;
      }
      offset += part.length + 1;
    }
  };

  const removeItem = (index: number) => {
    const next = values.filter((_, itemIndex) => itemIndex !== index);
    setDraft({ key: JSON.stringify(next), text: next.join(" | ") });
    onChange(next);
  };

  const fieldProps = {
    id,
    value: draft.text,
    placeholder,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => changeText(event.target.value),
  };

  return (
    <div>
      <FormField label={label} htmlFor={id} hint={hint}>
        {multiline ? <Textarea {...fieldProps} rows={2} /> : <Input {...fieldProps} />}
      </FormField>
      {values.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-label={`${label} elementlari`}>
          {values.map((item, index) => (
            <li key={`${index}:${item}`} className="flex flex-wrap items-center gap-x-2 rounded-xl bg-brand/5 pl-3 pr-1">
              <span className="min-w-0 flex-1 break-words py-2 text-xs font-semibold text-ink">{item}</span>
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-brand"
                  aria-label={`${item} — tahrirlash`}
                  onClick={() => editItem(item)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Tahrirlash
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-coral hover:bg-coral/10 focus-visible:outline-2 focus-visible:outline-coral"
                  aria-label={`${item} — o‘chirish`}
                  onClick={() => removeItem(index)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> O‘chirish
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
