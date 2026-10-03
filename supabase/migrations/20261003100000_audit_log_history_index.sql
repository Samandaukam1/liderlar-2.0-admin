-- =========================================================================
-- AUDIT JURNALI: OBYEKT TARIXI UCHUN INDEKS
-- =========================================================================
--
-- Nomzod sahifasidagi "Tarix" va jurnal sahifasidagi `?eid=` filtri
-- doim bir xil so'rov beradi:
--
--   where entity_type = 'candidate' and entity_id = $1
--   order by created_at desc
--   limit 40
--
-- Mavjud `idx_audit_logs_entity (entity_type, entity_id)` qatorlarni
-- topadi, lekin ularni vaqt bo'yicha qayta saralashga majbur. VIP va
-- profil hodisalari endi har bir nomzod uchun ko'p yozuv qoldiradi
-- (har tahrir, har rasm, har sertifikat) — saralash har ochilishda
-- o'sib boradi.
--
-- Yangi indeks eskisining o'rnini to'liq bosadi: uning boshlang'ich
-- ikki ustuni aynan eski indeks. Shuning uchun eskisi olib tashlanadi —
-- ikkita indeks har bir yozuvda ikki marta yangilanadi.
--
-- `if not exists` / `if exists` — migratsiyani qayta ishga tushirish
-- xavfsiz.

create index if not exists idx_audit_logs_entity_time
  on public.audit_logs (entity_type, entity_id, created_at desc);

drop index if exists public.idx_audit_logs_entity;
