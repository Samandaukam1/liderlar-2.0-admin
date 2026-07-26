# Liderlar.uz 2.0 — Supabase sxemasi

Bu papka **liderlar-admin** va **liderlar-web** loyihalari uchun yagona (canonical)
ma'lumotlar bazasi sxemasini o'z ichiga oladi. Ikkala loyiha ham bitta Supabase
loyihasidan foydalanadi.

## Qo'llash tartibi

Supabase Dashboard → **SQL Editor** da fayllarni **quyidagi tartibda** ishga tushiring:

1. `migrations/0001_extensions.sql` — kengaytmalar va `set_updated_at()` trigger funksiyasi
2. `migrations/0002_core_schema.sql` — profiles, roles, user_roles, regions, categories, candidates
3. `migrations/0003_content_schema.sql` — nomzod bo'limlari, media, maqolalar, podcastlar, jurnal, iqtiboslar, arizalar, huquqiy sahifalar, sozlamalar
4. `migrations/0004_ranking_schema.sql` — reyting jadvallar
5. `migrations/0005_monthly_updates.sql` — 30 kunlik tokenlar va yangilanishlar
6. `migrations/0006_admin_and_audit.sql` — audit_logs va role_permissions matritsasi
7. `migrations/0007_ai_and_notifications.sql` — ai_jobs, ai_chat, notifications
8. `migrations/0008_storage_and_rls.sql` — storage bucketlar, RLS va policy'lar
9. `migrations/0009_functions_and_triggers.sql` — reyting hisoblash va boshqa funksiyalar
10. `migrations/0010_candidate_intake_v2.sql` — nomzod anketasi (intake) tizimi: yangi jadvallar, RLS, `candidate-intake-files` bucketi, `submit_candidate_intake` / `promote_candidate_intake` RPC'lari, faol shablon + 15 savol, sozlamalar. **Non-destructive va idempotent** — mavjud sxemani buzmaydi.
11. `migrations/0012_ai_prompts_permissions.sql` — AI promptlari uchun permission matritsasi
12. `migrations/0013_candidate_photo_confirmation.sql` — nomzod rasmi tasdiqlash oqimi
13. `migrations/0014_candidate_adabiyotx_items.sql` — cross-project `integration_key`, AdabiyotX materiallari, RLS va atomic reorder RPC
14. `seed.sql` — hududlar, yo'nalishlar, boshlang'ich reyting davri, sozlamalar

Barcha fayllar **idempotent** — qayta ishga tushirish xavfsiz.

## Birinchi super adminni yaratish

1. Dashboard → **Authentication → Users → Add user** (email + parol, auto-confirm).
2. SQL Editor da:

```sql
select public.grant_role_by_email('sizning@email.uz', 'super_admin');
```

3. Admin panelga (`http://localhost:3001/login`) shu email/parol bilan kiring.

## Storage bucketlar

| Bucket | Ochiq? | Vazifasi |
|---|---|---|
| candidate-avatars | ha | Nomzod portretlari |
| candidate-gallery | ha | Galereya va maqola muqovalari |
| monthly-update-media | yo'q | Oylik yangilanish fayllari (signed URL) |
| journal-covers | ha | Jurnal muqovalari |
| journal-pdfs | yo'q | Jurnal PDF (signed URL) |
| podcast-media | ha | Podcast banner/media |
| application-files | yo'q | Ariza fayllari (signed URL) |
| admin-private-files | yo'q | Ichki fayllar (signed URL) |

## Xavfsizlik modeli

- **RLS hamma jadvalda yoqilgan.** Anon (sayt) faqat nashr etilgan kontentni ko'radi.
- Admin o'qish/yozish `role_permissions` matritsasi orqali `has_permission()` bilan
  tekshiriladi. Bu matritsa `src/lib/permissions.ts` dagi TS xaritasining nusxasi —
  ikkalasini sinxron saqlang.
- **service_role** kaliti RLSni chetlab o'tadi — u faqat serverda
  (`src/lib/supabase/admin.ts`, `server-only`) va har doim `requirePermission()`
  tekshiruvidan keyin ishlatiladi.
- Oylik token'larning **xom qiymati saqlanmaydi** — faqat SHA-256 hash
  (`monthly_update_tokens.token_hash`).
- `profile_views` ga to'g'ridan-to'g'ri yozib bo'lmaydi — faqat
  `record_profile_view()` funksiyasi orqali (kunlik dedup, bot filtri).

## Muhim funksiyalar

| Funksiya | Vazifasi |
|---|---|
| `is_admin()`, `has_any_role(text[])`, `has_permission(text)` | RLS ruxsat tekshiruvlari |
| `recalculate_rankings()` | Joriy davr uchun barcha reytinglarni qayta hisoblaydi |
| `get_due_candidates(days)` | 30 kunlik yangilash muddati kelganlar |
| `record_profile_view(slug, viewer_hash)` | Ko'rishni xavfsiz qayd qilish |
| `verify_update_token(hash)` / `start_monthly_update(hash)` | liderlar-web ochiq forma oqimi |
| `expire_stale_tokens()` | Eski tokenlarni tozalash |
| `create_article_revision(article, actor, autosave)` | Maqola versiyasini yaratish |
| `prepare_update_merge(update)` | Birlashtirishdan oldingi xulosa |
| `write_audit_log(...)` | Audit yozuvi |
| `grant_role_by_email(email, role)` | Admin rol berish (seed) |
