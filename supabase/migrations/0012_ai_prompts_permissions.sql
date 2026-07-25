-- ============================================================
-- Liderlar.uz 2.0 — 0012: AI Prompts ruxsatlari
-- src/lib/permissions.ts dagi ai_prompts.* ruxsatlarining SQL nusxasi
-- (role_permissions matritsasi bilan sinxron). Idempotent.
--
-- ESLATMA: Admin panel server action'lari service_role bilan ishlab,
-- requirePermission() (TS matritsa) orqali tekshiradi. Bu yozuvlar faqat
-- RLS darajasidagi has_permission() tekshiruvini sinxron saqlash uchun.
-- ============================================================

insert into public.role_permissions (role_slug, permission) values
  ('admin', 'ai_prompts.view'),
  ('admin', 'ai_prompts.edit'),
  ('viewer', 'ai_prompts.view')
on conflict do nothing;
