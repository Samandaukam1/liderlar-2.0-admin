import type { FieldSpec } from "@/components/admin/resource-form";

export const PODCAST_FIELDS: FieldSpec[] = [
  { name: "title", label: "Mavzu", type: "text", required: true },
  { name: "starts_at", label: "Sana va vaqt", type: "datetime" },
  { name: "description", label: "Tavsif", type: "textarea" },
  { name: "location", label: "Joy", type: "text", placeholder: "Toshkent, IT Park" },
  { name: "online_url", label: "Onlayn havola", type: "text", placeholder: "https://" },
  { name: "host_name", label: "Boshlovchi", type: "text" },
  {
    name: "status",
    label: "Status",
    type: "select",
    required: true,
    options: [
      { value: "planned", label: "Rejada" },
      { value: "announced", label: "E’lon qilingan" },
      { value: "live", label: "Jonli" },
      { value: "recorded", label: "Yozib olingan" },
      { value: "published", label: "Nashr etilgan" },
      { value: "cancelled", label: "Bekor qilingan" },
    ],
  },
  { name: "registration_limit", label: "Ro‘yxatdan o‘tish limiti", type: "number" },
  { name: "media_url", label: "Video/audio havolasi", type: "text", placeholder: "https://youtube.com/…" },
  { name: "banner_url", label: "Banner", type: "upload", bucket: "podcast-media" },
  { name: "cancel_reason", label: "Bekor qilish sababi", type: "textarea" },
];
