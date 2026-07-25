"use client";

import { useState, useCallback } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Undo2,
  Redo2,
  Link as LinkIcon,
  Table as TableIcon,
  Grid3x3,
  Paperclip,
  Ban,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/overlays";
import { Button, Input } from "@/components/ui/primitives";

function Tb({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-brand/10 hover:text-ink disabled:opacity-40",
        active && "bg-brand/15 text-brand",
      )}
    >
      {children}
    </button>
  );
}

/** Parse pasted/typed delimited text into a matrix. */
function parseTable(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const delim = line.includes("\t") ? "\t" : line.includes("|") ? "|" : ",";
    return line
      .split(delim)
      .map((c) => c.trim())
      .filter((_, i, arr) => !(delim === "|" && (i === 0 || i === arr.length - 1) && arr[i] === ""));
  });
}

function TableControls({ editor }: { editor: Editor }) {
  if (!editor.isActive("table")) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-line bg-surface/60 px-2 py-1.5">
      <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-ink-soft">Jadval</span>
      <Tb title="Qator qo‘shish" onClick={() => editor.chain().focus().addRowAfter().run()}>
        <Plus className="h-3.5 w-3.5" /><span className="text-[10px]">Q</span>
      </Tb>
      <Tb title="Ustun qo‘shish" onClick={() => editor.chain().focus().addColumnAfter().run()}>
        <Plus className="h-3.5 w-3.5" /><span className="text-[10px]">U</span>
      </Tb>
      <Tb title="Qatorni o‘chirish" onClick={() => editor.chain().focus().deleteRow().run()}>
        <Trash2 className="h-3.5 w-3.5" /><span className="text-[10px]">Q</span>
      </Tb>
      <Tb title="Ustunni o‘chirish" onClick={() => editor.chain().focus().deleteColumn().run()}>
        <Trash2 className="h-3.5 w-3.5" /><span className="text-[10px]">U</span>
      </Tb>
      <Tb title="Sarlavha qatori" onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
        <span className="text-[10px] font-bold">H</span>
      </Tb>
      <Tb title="Kataklarni birlashtirish" onClick={() => editor.chain().focus().mergeOrSplit().run()}>
        <span className="text-[10px] font-bold">⇔</span>
      </Tb>
      <Tb title="Jadvalni o‘chirish" onClick={() => editor.chain().focus().deleteTable().run()}>
        <Trash2 className="h-3.5 w-3.5 text-coral" />
      </Tb>
    </div>
  );
}

export interface RichEditorProps {
  value?: unknown;
  editable?: boolean;
  placeholder?: string;
  onChange?: (json: unknown, text: string) => void;
  onAttachClick?: () => void;
  onNoAnswer?: () => void;
  showNoAnswer?: boolean;
}

export function RichEditor({
  value,
  editable = true,
  placeholder = "Javobingizni yozing…",
  onChange,
  onAttachClick,
  onNoAnswer,
  showNoAnswer = true,
}: RichEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        },
      }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder }),
    ],
    content: (value as object) ?? { type: "doc", content: [] },
    onUpdate: ({ editor }) => onChange?.(editor.getJSON(), editor.getText()),
  });

  const applyLink = useCallback(() => {
    if (!editor) return;
    const url = linkUrl.trim();
    if (!/^https?:\/\/.+/i.test(url)) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    setLinkOpen(false);
    setLinkUrl("");
  }, [editor, linkUrl]);

  const convertToTable = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n") || "";
    const matrix = parseTable(text);
    if (matrix.length === 0) {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      return;
    }
    const cols = Math.max(...matrix.map((r) => r.length));
    const html = [
      "<table><tbody>",
      ...matrix.map(
        (row, ri) =>
          "<tr>" +
          Array.from({ length: cols }, (_, ci) => {
            const cell = (row[ci] ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            return ri === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`;
          }).join("") +
          "</tr>",
      ),
      "</tbody></table>",
    ].join("");
    editor.chain().focus().deleteSelection().insertContent(html).run();
  }, [editor]);

  if (!editor) {
    return <div className="min-h-[120px] rounded-field border border-line bg-card" aria-busy />;
  }

  return (
    <div className="overflow-hidden rounded-field border border-line bg-card focus-within:border-brand/50">
      {editable && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface/50 px-2 py-1.5">
          <Tb title="Qalin" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold className="h-4 w-4" />
          </Tb>
          <Tb title="Kursiv" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic className="h-4 w-4" />
          </Tb>
          <Tb title="Tagchiziq" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <Underline className="h-4 w-4" />
          </Tb>
          <span className="mx-1 h-5 w-px bg-line" />
          <Tb title="Belgili ro‘yxat" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List className="h-4 w-4" />
          </Tb>
          <Tb title="Raqamli ro‘yxat" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered className="h-4 w-4" />
          </Tb>
          <span className="mx-1 h-5 w-px bg-line" />
          <Tb title="Havola" active={editor.isActive("link")} onClick={() => { setLinkUrl((editor.getAttributes("link").href as string) ?? ""); setLinkOpen(true); }}>
            <LinkIcon className="h-4 w-4" />
          </Tb>
          <Tb title="Jadval qo‘shish" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
            <TableIcon className="h-4 w-4" />
          </Tb>
          <Tb title="Jadvalga aylantirish" onClick={convertToTable}>
            <Grid3x3 className="h-4 w-4" />
          </Tb>
          <span className="mx-1 h-5 w-px bg-line" />
          <Tb title="Bekor qilish" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
            <Undo2 className="h-4 w-4" />
          </Tb>
          <Tb title="Qaytarish" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
            <Redo2 className="h-4 w-4" />
          </Tb>
          <div className="ml-auto flex items-center gap-0.5">
            {onAttachClick && (
              <Tb title="Fayl biriktirish" onClick={onAttachClick}>
                <Paperclip className="h-4 w-4" />
              </Tb>
            )}
            {showNoAnswer && onNoAnswer && (
              <button
                type="button"
                onClick={onNoAnswer}
                className="ml-1 flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold text-ink-soft transition hover:border-peach hover:bg-peach/10 hover:text-amber"
              >
                <Ban className="h-3.5 w-3.5" /> Yo‘q
              </button>
            )}
          </div>
        </div>
      )}

      <TableControls editor={editor} />

      <EditorContent
        editor={editor}
        className="intake-prose max-h-[420px] min-h-[120px] overflow-y-auto px-3.5 py-3 text-sm leading-relaxed text-ink"
      />

      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Havola qo‘shish">
        <div className="space-y-3">
          <Input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://…"
            onKeyDown={(e) => e.key === "Enter" && applyLink()}
          />
          <p className="text-xs text-ink-soft">Faqat http:// yoki https:// havolalar. Yangi oynada, xavfsiz (noopener) ochiladi.</p>
          <div className="flex justify-between gap-2">
            {editor.isActive("link") ? (
              <Button variant="ghost" onClick={() => { editor.chain().focus().unsetLink().run(); setLinkOpen(false); }}>
                Havolani olib tashlash
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setLinkOpen(false)}>Bekor</Button>
              <Button onClick={applyLink} disabled={!/^https?:\/\/.+/i.test(linkUrl.trim())}>Qo‘shish</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
