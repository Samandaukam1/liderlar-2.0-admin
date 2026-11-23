"use client";

import { useState, type ChangeEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FormField, Input, Textarea } from "@/components/ui/primitives";
import { splitPipeValues } from "@/lib/candidates/parser";

interface FieldDraft {
  key: string;
  text: string;
  items: Array<{ id: number; text: string }>;
  nextId: number;
  focusId: number | null;
}

function makeDraft(values: string[]): FieldDraft {
  return {
    key: JSON.stringify(values),
    text: values.join(" | "),
    items: values.map((text, id) => ({ id, text })),
    nextId: values.length,
    focusId: null,
  };
}

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
  const [draft, setDraft] = useState(() => makeDraft(values));

  // AI/parsing can replace these values. Our own updates already carry the
  // same key, so ordinary typing keeps spaces, delimiters and the caret intact.
  if (draft.key !== valuesKey) {
    setDraft(makeDraft(values));
  }

  const changeText = (text: string) => {
    const next = splitPipeValues(text);
    setDraft({ ...makeDraft(next), text });
    onChange(next);
  };

  const changeItems = (items: FieldDraft["items"], nextId = draft.nextId, focusId = draft.focusId) => {
    const text = items.map((item) => item.text).join(" | ");
    const next = splitPipeValues(text);
    setDraft({ key: JSON.stringify(next), text, items, nextId, focusId });
    onChange(next);
  };

  const editItem = (itemId: number, text: string) => {
    let nextId = draft.nextId;
    const pieces = text.split("|").map((part, index) => ({ id: index === 0 ? itemId : nextId++, text: part }));
    const items = draft.items.flatMap((item) => item.id === itemId ? pieces : [item]);
    changeItems(items, nextId, pieces.length > 1 ? pieces[pieces.length - 1].id : draft.focusId);
  };

  const addItem = () => {
    changeItems([...draft.items, { id: draft.nextId, text: "" }], draft.nextId + 1, draft.nextId);
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
      {draft.items.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-label={`${label} elementlari`}>
          {draft.items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2 rounded-xl bg-brand/5 p-2">
              <Input
                value={item.text}
                onChange={(event) => editItem(item.id, event.target.value)}
                aria-label={`${label} — ${index + 1}-element`}
                placeholder="Yangi element"
                className="min-w-0 flex-1 text-xs"
                autoFocus={item.id === draft.focusId}
              />
              <button
                type="button"
                className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-coral hover:bg-coral/10 focus-visible:outline-2 focus-visible:outline-coral"
                aria-label={`${item.text || `${index + 1}-element`} — o‘chirish`}
                onClick={() => changeItems(draft.items.filter((row) => row.id !== item.id))}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> O‘chirish
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-brand/40 px-3 text-xs font-bold text-brand hover:bg-brand/5 focus-visible:outline-2 focus-visible:outline-brand"
        aria-label={`${label} — element qo‘shish`}
        onClick={addItem}
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Qo‘shish
      </button>
    </div>
  );
}
