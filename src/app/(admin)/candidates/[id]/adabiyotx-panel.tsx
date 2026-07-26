"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Library,
  Link2,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/admin/badges";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { ConfirmDialog, Modal } from "@/components/ui/overlays";
import {
  Button,
  Card,
  FormField,
  Input,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type {
  AdabiyotXContentType,
  AdabiyotXSearchItem,
  CandidateAdabiyotXItem,
  CandidateAdabiyotXRelationship,
} from "@/lib/adabiyotx/types";

const CONTENT_LABELS: Record<AdabiyotXContentType, string> = {
  book: "Kitob",
  article: "Maqola",
  poem: "She’r",
  scenario: "Ssenariy",
  other: "Boshqa",
};

const RELATIONSHIP_LABELS: Record<CandidateAdabiyotXRelationship, string> = {
  own_work: "Ijodiy ishi",
  read_book: "O‘qigan kitobi",
};

interface ApiErrorBody {
  ok: false;
  code: string;
  error: string;
}

class ApiRequestError extends Error {
  code: string;

  constructor(body: ApiErrorBody) {
    super(body.error);
    this.code = body.code;
  }
}

async function readApiResponse<T extends object>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | T
    | ApiErrorBody
    | null;
  if (!response.ok || !body || ("ok" in body && body.ok === false)) {
    const errorBody =
      body && "ok" in body && body.ok === false
        ? body
        : {
            ok: false as const,
            code: "REQUEST_FAILED",
            error: "So‘rovni bajarib bo‘lmadi.",
          };
    throw new ApiRequestError(errorBody);
  }
  return body as T;
}

async function fetchCandidateItems(
  candidateId: string,
  signal?: AbortSignal,
): Promise<CandidateAdabiyotXItem[]> {
  const response = await fetch(
    `/api/admin/candidates/${candidateId}/adabiyotx-items`,
    { signal, cache: "no-store" },
  );
  const result = await readApiResponse<{
    ok: true;
    items: CandidateAdabiyotXItem[];
  }>(response);
  return result.items;
}

function AdabiyotXCover({
  src,
  title,
  size = "list",
}: {
  src: string | null;
  title: string;
  size?: "list" | "search";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const broken = src != null && failedSrc === src;

  const classes =
    size === "search" ? "h-24 w-16 sm:h-28 sm:w-20" : "h-20 w-14";
  if (!src || broken) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-[12px] border border-line bg-gradient-to-br from-sky/15 to-lavender/20 text-brand",
          classes,
        )}
        aria-label={`${title} uchun muqova mavjud emas`}
      >
        <BookOpen className="h-6 w-6" aria-hidden />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- catalog image hosts are intentionally dynamic
    <img
      src={src}
      alt={`${title} muqovasi`}
      className={cn(
        "shrink-0 rounded-[12px] border border-line object-cover",
        classes,
      )}
      onError={() => setFailedSrc(src)}
    />
  );
}

function ItemBadges({
  contentType,
  relationshipType,
}: {
  contentType: AdabiyotXContentType;
  relationshipType?: CandidateAdabiyotXRelationship;
}) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <Badge accent="sky">{CONTENT_LABELS[contentType]}</Badge>
      {relationshipType ? (
        <Badge accent="lavender">
          {RELATIONSHIP_LABELS[relationshipType]}
        </Badge>
      ) : null}
    </span>
  );
}

function ManualItemForm({
  candidateId,
  relationshipType,
  onCreated,
  onCancel,
}: {
  candidateId: string;
  relationshipType: CandidateAdabiyotXRelationship;
  onCreated: (item: CandidateAdabiyotXItem) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [contentType, setContentType] = useState<AdabiyotXContentType>(
    relationshipType === "read_book" ? "book" : "book",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const publishedAt = String(form.get("publishedAt") ?? "").trim();

    try {
      const response = await fetch(
        `/api/admin/candidates/${candidateId}/adabiyotx-items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            relationshipType,
            contentType:
              relationshipType === "read_book" ? "book" : contentType,
            title: String(form.get("title") ?? ""),
            authorName: String(form.get("authorName") ?? "") || null,
            description: String(form.get("description") ?? "") || null,
            coverUrl: String(form.get("coverUrl") ?? "") || null,
            externalUrl: String(form.get("externalUrl") ?? ""),
            publishedAt: publishedAt || null,
            isVisible: true,
            metadata: { source: "manual_url" },
          }),
        },
      );
      const result = await readApiResponse<{
        ok: true;
        item: CandidateAdabiyotXItem;
      }>(response);
      onCreated(result.item);
      toast("success", "Material biriktirildi");
    } catch (error) {
      toast(
        "error",
        "Material biriktirilmadi",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <FormField label="AdabiyotX URL" htmlFor="manual_external_url">
        <Input
          id="manual_external_url"
          name="externalUrl"
          type="url"
          inputMode="url"
          placeholder="https://adabiyotx.uz/..."
          required
        />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Munosabat turi" htmlFor="manual_relationship">
          <Input
            id="manual_relationship"
            value={RELATIONSHIP_LABELS[relationshipType]}
            disabled
          />
        </FormField>
        <FormField label="Material turi" htmlFor="manual_content_type">
          <Select
            id="manual_content_type"
            value={relationshipType === "read_book" ? "book" : contentType}
            disabled={relationshipType === "read_book"}
            onChange={(event) =>
              setContentType(event.target.value as AdabiyotXContentType)
            }
          >
            <option value="book">Kitob</option>
            <option value="article">Maqola</option>
            <option value="poem">She’r</option>
            <option value="scenario">Ssenariy</option>
            <option value="other">Boshqa</option>
          </Select>
        </FormField>
      </div>

      <FormField label="Sarlavha" htmlFor="manual_title">
        <Input id="manual_title" name="title" maxLength={500} required />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Muallif" htmlFor="manual_author">
          <Input id="manual_author" name="authorName" maxLength={300} />
        </FormField>
        <FormField label="Chop etilgan sana" htmlFor="manual_published">
          <Input id="manual_published" name="publishedAt" type="date" />
        </FormField>
      </div>

      <FormField label="Cover URL" htmlFor="manual_cover">
        <Input
          id="manual_cover"
          name="coverUrl"
          type="url"
          inputMode="url"
          placeholder="https://..."
        />
      </FormField>

      <FormField label="Qisqa tavsif" htmlFor="manual_description">
        <Textarea
          id="manual_description"
          name="description"
          rows={3}
          maxLength={5000}
        />
      </FormField>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Bekor qilish
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="h-4 w-4" />
          )}
          {submitting ? "Biriktirilmoqda…" : "Biriktirish"}
        </Button>
      </div>
    </form>
  );
}

export function AdabiyotXPanel({
  candidateId,
  canEdit,
}: {
  candidateId: string;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<CandidateAdabiyotXItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [relationship, setRelationship] =
    useState<CandidateAdabiyotXRelationship>("own_work");
  const [query, setQuery] = useState("");
  const [searchItems, setSearchItems] = useState<AdabiyotXSearchItem[]>([]);
  const [searchStatus, setSearchStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [searchError, setSearchError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteItem, setDeleteItem] =
    useState<CandidateAdabiyotXItem | null>(null);
  const searchRequestId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchCandidateItems(candidateId, controller.signal)
      .then((loadedItems) => {
        if (controller.signal.aborted) return;
        setItems(loadedItems);
        setItemsError(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setItemsError(
          error instanceof Error
            ? error.message
            : "Materiallarni yuklab bo‘lmadi.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setItemsLoading(false);
      });
    return () => controller.abort();
  }, [candidateId]);

  useEffect(() => {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 2) return;
    const requestId = ++searchRequestId.current;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchStatus("loading");
      setSearchError(null);
      try {
        const response = await fetch(
          `/api/admin/integrations/adabiyotx/search?q=${encodeURIComponent(cleanQuery)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const result = await readApiResponse<{
          ok: true;
          items: AdabiyotXSearchItem[];
        }>(response);
        if (searchRequestId.current !== requestId) return;
        setSearchItems(result.items);
        setSearchStatus("success");
      } catch (error) {
        if (controller.signal.aborted || searchRequestId.current !== requestId) {
          return;
        }
        const requestError =
          error instanceof ApiRequestError
            ? error
            : new ApiRequestError({
                ok: false,
                code: "ADABIYOTX_SEARCH_FAILED",
                error: "AdabiyotX katalogida qidirib bo‘lmadi.",
              });
        setSearchItems([]);
        setSearchError({
          code: requestError.code,
          message: requestError.message,
        });
        setSearchStatus("error");
      }
    }, 400);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const retryLoadItems = useCallback(async () => {
    setItemsLoading(true);
    setItemsError(null);
    try {
      setItems(await fetchCandidateItems(candidateId));
    } catch (error) {
      setItemsError(
        error instanceof Error
          ? error.message
          : "Materiallarni yuklab bo‘lmadi.",
      );
    } finally {
      setItemsLoading(false);
    }
  }, [candidateId]);

  function changeQuery(value: string) {
    searchRequestId.current += 1;
    setQuery(value);
    setSearchItems([]);
    setSearchStatus("idle");
    setSearchError(null);
  }

  const activeItems = useMemo(
    () =>
      items
        .filter((item) => item.relationshipType === relationship)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [items, relationship],
  );

  const visibleSearchItems = useMemo(
    () =>
      relationship === "read_book"
        ? searchItems.filter((item) => item.contentType === "book")
        : searchItems,
    [relationship, searchItems],
  );

  function addCreatedItem(item: CandidateAdabiyotXItem) {
    setItems((current) => [...current, item]);
    setManualOpen(false);
  }

  async function attachSearchItem(item: AdabiyotXSearchItem) {
    const operationId = `attach:${item.externalId}`;
    setBusyId(operationId);
    try {
      const response = await fetch(
        `/api/admin/candidates/${candidateId}/adabiyotx-items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...item,
            relationshipType: relationship,
            contentType: relationship === "read_book" ? "book" : item.contentType,
            metadata: { source: "adabiyotx_search" },
          }),
        },
      );
      const result = await readApiResponse<{
        ok: true;
        item: CandidateAdabiyotXItem;
      }>(response);
      setItems((current) => [...current, result.item]);
      toast("success", "Material biriktirildi");
    } catch (error) {
      toast(
        "error",
        "Material biriktirilmadi",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setBusyId(null);
    }
  }

  async function toggleVisibility(item: CandidateAdabiyotXItem) {
    const previous = items;
    setBusyId(`visibility:${item.id}`);
    setItems((current) =>
      current.map((row) =>
        row.id === item.id ? { ...row, isVisible: !row.isVisible } : row,
      ),
    );
    try {
      const response = await fetch(
        `/api/admin/candidates/${candidateId}/adabiyotx-items/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isVisible: !item.isVisible }),
        },
      );
      const result = await readApiResponse<{
        ok: true;
        item: CandidateAdabiyotXItem;
      }>(response);
      setItems((current) =>
        current.map((row) => (row.id === item.id ? result.item : row)),
      );
      toast(
        "success",
        result.item.isVisible ? "Material ko‘rsatildi" : "Material yashirildi",
      );
    } catch (error) {
      setItems(previous);
      toast(
        "error",
        "Ko‘rinish holati saqlanmadi",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setBusyId(null);
    }
  }

  async function moveItem(item: CandidateAdabiyotXItem, direction: -1 | 1) {
    const currentIndex = activeItems.findIndex((row) => row.id === item.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= activeItems.length) {
      return;
    }

    const reordered = [...activeItems];
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex],
    ];
    const normalized = reordered.map((row, index) => ({
      ...row,
      sortOrder: index,
    }));
    const previous = items;
    const byId = new Map(normalized.map((row) => [row.id, row]));
    setItems((current) => current.map((row) => byId.get(row.id) ?? row));
    setBusyId(`reorder:${item.id}`);

    try {
      const response = await fetch(
        `/api/admin/candidates/${candidateId}/adabiyotx-items/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: normalized.map((row) => ({
              id: row.id,
              sortOrder: row.sortOrder,
            })),
          }),
        },
      );
      await readApiResponse<{ ok: true }>(response);
      toast("success", "Materiallar tartibi saqlandi");
    } catch (error) {
      setItems(previous);
      toast(
        "error",
        "Tartib saqlanmadi",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteItem) return;
    const item = deleteItem;
    setBusyId(`delete:${item.id}`);
    try {
      const response = await fetch(
        `/api/admin/candidates/${candidateId}/adabiyotx-items/${item.id}`,
        { method: "DELETE" },
      );
      await readApiResponse<{ ok: true }>(response);
      setItems((current) => current.filter((row) => row.id !== item.id));
      setDeleteItem(null);
      toast("success", "Material olib tashlandi");
    } catch (error) {
      toast(
        "error",
        "Material olib tashlanmadi",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Card className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-xl bg-brand/10 p-2 text-brand">
                <Library className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-ink">
                  AdabiyotX materiallari
                </h2>
                <p className="text-xs text-ink-soft">
                  Katalog materiallarini nomzod profiliga biriktiring.
                </p>
              </div>
            </div>
          </div>
          {canEdit ? (
            <Button variant="secondary" onClick={() => setManualOpen(true)}>
              <Link2 className="h-4 w-4" />
              AdabiyotX havolasi orqali qo‘shish
            </Button>
          ) : null}
        </div>

        <div
          className="flex gap-1 rounded-[14px] border border-line bg-surface p-1"
          role="tablist"
          aria-label="AdabiyotX material turlari"
        >
          {(
            [
              ["own_work", "Ijodiy ishlari", FileText],
              ["read_book", "O‘qigan kitoblari", BookOpen],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={relationship === value}
              onClick={() => setRelationship(value)}
              className={cn(
                "inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[11px] px-3 text-sm font-bold transition",
                relationship === value
                  ? "bg-card text-brand shadow-sm"
                  : "text-ink-soft hover:text-ink",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {canEdit ? (
          <section aria-labelledby="adabiyotx-search-title">
            <h3
              id="adabiyotx-search-title"
              className="mb-2 text-sm font-bold text-ink"
            >
              Katalogdan qidirish
            </h3>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <Input
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                className="pl-10"
                placeholder={
                  relationship === "read_book"
                    ? "Kitob nomi yoki muallif…"
                    : "Kitob, maqola, she’r yoki ssenariy…"
                }
                aria-label="AdabiyotX katalogida qidirish"
              />
            </div>
            {query.trim().length === 1 ? (
              <p className="mt-1.5 text-xs text-ink-soft">
                Qidirish uchun yana 1 belgi kiriting.
              </p>
            ) : null}

            {searchStatus === "loading" ? (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {[0, 1].map((key) => (
                  <div
                    key={key}
                    className="flex gap-3 rounded-[16px] border border-line p-3"
                  >
                    <Skeleton className="h-24 w-16 shrink-0" />
                    <div className="flex-1 space-y-2 pt-1">
                      <Skeleton className="h-4 w-4/5" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-8 w-28" />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {searchStatus === "error" && searchError ? (
              <div
                className="mt-3 rounded-[16px] border border-amber/40 bg-amber/8 p-4"
                role="alert"
              >
                <p className="text-sm font-semibold text-ink">
                  {searchError.code === "ADABIYOTX_SEARCH_NOT_CONFIGURED"
                    ? "AdabiyotX qidiruvi hali sozlanmagan. Materialni havola orqali qo‘shishingiz mumkin."
                    : searchError.message}
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="secondary"
                  onClick={() => setManualOpen(true)}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Havola orqali qo‘shish
                </Button>
              </div>
            ) : null}

            {searchStatus === "success" &&
            query.trim().length >= 2 &&
            visibleSearchItems.length === 0 ? (
              <div className="mt-3 rounded-[16px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-soft">
                AdabiyotX katalogida natija topilmadi.
              </div>
            ) : null}

            {searchStatus === "success" && visibleSearchItems.length > 0 ? (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {visibleSearchItems.map((result) => {
                  const linked = items.some(
                    (item) =>
                      item.externalId === result.externalId &&
                      item.relationshipType === relationship,
                  );
                  const operationId = `attach:${result.externalId}`;
                  return (
                    <article
                      key={`${relationship}:${result.externalId}`}
                      className="flex min-w-0 gap-3 rounded-[16px] border border-line bg-card p-3"
                    >
                      <AdabiyotXCover
                        src={result.coverUrl}
                        title={result.title}
                        size="search"
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <ItemBadges contentType={result.contentType} />
                        <h4 className="mt-1.5 line-clamp-2 text-sm font-bold text-ink">
                          {result.title}
                        </h4>
                        <p className="mt-0.5 truncate text-xs text-ink-soft">
                          {result.authorName ?? "Muallif ko‘rsatilmagan"}
                        </p>
                        <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                          <a
                            href={result.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-line px-2.5 text-xs font-bold text-brand transition hover:bg-brand/5"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Ochish
                          </a>
                          <Button
                            size="sm"
                            onClick={() => void attachSearchItem(result)}
                            disabled={linked || busyId === operationId}
                          >
                            {busyId === operationId ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Plus className="h-3.5 w-3.5" />
                            )}
                            {linked ? "Biriktirilgan" : "Biriktirish"}
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : (
          <p className="rounded-[14px] border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
            Materiallarni boshqarish uchun candidates.edit ruxsati kerak.
          </p>
        )}

        <section aria-labelledby="linked-materials-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 id="linked-materials-title" className="text-sm font-bold text-ink">
              Biriktirilgan materiallar
            </h3>
            <Badge accent="brand">{activeItems.length} ta</Badge>
          </div>

          {itemsLoading ? (
            <div className="space-y-2">
              {[0, 1].map((key) => (
                <Skeleton key={key} className="h-24 w-full" />
              ))}
            </div>
          ) : itemsError ? (
            <div
              className="rounded-[16px] border border-coral/35 bg-coral/5 p-4"
              role="alert"
            >
              <p className="text-sm font-semibold text-ink">{itemsError}</p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => void retryLoadItems()}
              >
                Qayta urinish
              </Button>
            </div>
          ) : activeItems.length === 0 ? (
            <EmptyState
              title="Hozircha material biriktirilmagan."
              description={
                canEdit
                  ? "Katalogdan qidiring yoki AdabiyotX havolasi orqali qo‘shing."
                  : undefined
              }
              icon={<Library className="h-7 w-7" />}
            />
          ) : (
            <ul className="space-y-2">
              {activeItems.map((item, index) => (
                <li
                  key={item.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-[16px] border bg-card p-3 sm:flex-row sm:items-center",
                    item.isVisible
                      ? "border-line"
                      : "border-dashed border-line-strong opacity-75",
                  )}
                >
                  <div className="flex min-w-0 flex-1 gap-3">
                    <AdabiyotXCover src={item.coverUrl} title={item.title} />
                    <div className="min-w-0 flex-1">
                      <ItemBadges
                        contentType={item.contentType}
                        relationshipType={item.relationshipType}
                      />
                      <p className="mt-1.5 truncate text-sm font-bold text-ink">
                        {item.title}
                      </p>
                      <p className="truncate text-xs text-ink-soft">
                        {item.authorName ?? "Muallif ko‘rsatilmagan"}
                      </p>
                      <a
                        href={item.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline"
                      >
                        AdabiyotX’da ochish
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>

                  {canEdit ? (
                    <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.isVisible}
                        aria-label={
                          item.isVisible ? "Materialni yashirish" : "Materialni ko‘rsatish"
                        }
                        title={item.isVisible ? "Ko‘rinadi" : "Yashirilgan"}
                        disabled={busyId === `visibility:${item.id}`}
                        onClick={() => void toggleVisibility(item)}
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-[10px] border px-2.5 text-xs font-bold transition disabled:opacity-50",
                          item.isVisible
                            ? "border-green/40 bg-green/10 text-[#2e7d44]"
                            : "border-line text-ink-soft",
                        )}
                      >
                        {item.isVisible ? (
                          <Eye className="h-3.5 w-3.5" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5" />
                        )}
                        {item.isVisible ? "Ko‘rinadi" : "Yashirilgan"}
                      </button>
                      <button
                        type="button"
                        aria-label={`${item.title}ni yuqoriga ko‘tarish`}
                        title="Yuqoriga"
                        disabled={index === 0 || busyId?.startsWith("reorder:")}
                        onClick={() => void moveItem(item, -1)}
                        className="rounded-[10px] border border-line p-2 text-ink-soft transition hover:border-brand/40 hover:text-brand disabled:opacity-35"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`${item.title}ni pastga tushirish`}
                        title="Pastga"
                        disabled={
                          index === activeItems.length - 1 ||
                          busyId?.startsWith("reorder:")
                        }
                        onClick={() => void moveItem(item, 1)}
                        className="rounded-[10px] border border-line p-2 text-ink-soft transition hover:border-brand/40 hover:text-brand disabled:opacity-35"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`${item.title}ni olib tashlash`}
                        title="Olib tashlash"
                        onClick={() => setDeleteItem(item)}
                        className="rounded-[10px] border border-coral/25 p-2 text-coral transition hover:bg-coral/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </Card>

      <Modal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="AdabiyotX havolasi orqali qo‘shish"
        wide
      >
        <ManualItemForm
          candidateId={candidateId}
          relationshipType={relationship}
          onCreated={addCreatedItem}
          onCancel={() => setManualOpen(false)}
        />
      </Modal>

      <ConfirmDialog
        open={deleteItem != null}
        onClose={() => setDeleteItem(null)}
        onConfirm={() => void confirmDelete()}
        title="Materialni olib tashlash"
        description={
          deleteItem
            ? `“${deleteItem.title}” nomzod profilidan olib tashlanadi.`
            : ""
        }
        confirmLabel="Olib tashlash"
        danger
        loading={deleteItem != null && busyId === `delete:${deleteItem.id}`}
      />
    </>
  );
}
