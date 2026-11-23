"use client";

import { DataTableToolbar } from "@/components/admin/toolbar";
import { POST_STATUSES, POST_STATUS_LABELS } from "@/lib/post-studio/types";

export function PostListFilters() {
  return (
    <DataTableToolbar
      searchPlaceholder="Nomzod ismi yoki slug bo‘yicha qidirish…"
      filters={[
        {
          key: "status",
          label: "Holat",
          options: POST_STATUSES.map((value) => ({ value, label: POST_STATUS_LABELS[value] })),
        },
      ]}
    />
  );
}
