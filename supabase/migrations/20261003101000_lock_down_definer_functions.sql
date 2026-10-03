-- =========================================================================
-- SECURITY DEFINER FUNKSIYALARINI YOPISH
-- =========================================================================
--
-- MUAMMO
--
-- Supabase'da `public` sxemasidagi har bir funksiya standart holatda
-- `anon` va `authenticated` rollariga ochiq (PUBLIC + standart huquqlar)
-- va PostgREST uni `/rest/v1/rpc/<nom>` orqali chaqirishga beradi.
-- SECURITY DEFINER funksiya esa EGASINING huquqi bilan ishlaydi — RLS
-- uni to'xtatmaydi.
--
-- Quyidagi funksiyalar ichida ruxsat tekshiruvi YO'Q va ular shu
-- holatda ochiq qolgan edi. Eng xavflilari:
--
--   grant_role_by_email      — HAR KIM o'ziga `super_admin` rolini
--                              berishi mumkin edi (anon kalit saytda
--                              ochiq turadi).
--   promote_candidate_intake — har qanday kirgan foydalanuvchi
--                              anketani nomzodga aylantirib, NASHR
--                              qilishi mumkin edi (o'z rasmi va
--                              slug'i bilan).
--   record_profile_view      — saytdagi bot filtri va cheklovni
--                              chetlab, ko'rishlarni cheksiz yozish:
--                              ko'rish reytingga ball beradi.
--   write_audit_log          — audit jurnaliga soxta yozuv qo'shish.
--   recalculate_rankings     — og'ir hisobni istalgancha ishga tushirish.
--
-- VIP bilan har bir a'zo `authenticated` akkauntga ega bo'ldi — ya'ni
-- "faqat adminlar kiradi" degan yashirin taxmin endi to'g'ri emas.
--
-- KOD BU FUNKSIYALARNI QANDAY CHAQIRADI
--
-- Ikkala repodagi BARCHA `.rpc(...)` chaqiruvlari service_role mijozi
-- orqali (`createSupabaseAdminClient` / `createAdminClient`). Brauzer
-- yoki foydalanuvchi sessiyasi bilan chaqiriladigan RPC yo'q — shuning
-- uchun yopish ilova ishini buzmaydi.
--
-- OCHIQ QOLADIGANLAR (ataylab):
--
--   has_permission, is_admin, has_any_role — RLS siyosatlari ularni
--       chaqiruvchi roli bilan ishlatadi; faqat chaqiruvchining O'Z
--       huquqini aytadi.
--   list_published_candidates_v2 — faqat nashr qilingan nomzodlar
--       (ommaviy ro'yxat).
--   trigger funksiyalari — ularni to'g'ridan-to'g'ri chaqirib bo'lmaydi.
--
-- XAVFSIZ QAYTA ISHGA TUSHIRISH: funksiya bazada bo'lmasa (masalan,
-- boshqa muhitda), u o'tkazib yuboriladi va NOTICE chiqadi.
-- =========================================================================

do $$
declare
  v_signature text;
  v_fn regprocedure;
begin
  foreach v_signature in array array[
    -- Rol berish: ichida hech qanday ruxsat tekshiruvi yo'q.
    'public.grant_role_by_email(text, text)',
    -- Audit jurnali: soxta yozuv.
    'public.write_audit_log(uuid, text, text, text, jsonb, jsonb, text, text)',
    -- Reyting va ko'rishlar.
    'public.record_profile_view(text, text, uuid, boolean)',
    'public.recalculate_rankings()',
    'public.get_due_candidates(integer)',
    -- Oylik yangilanish tokenlari (sayt ularni server orqali chaqiradi).
    'public.verify_update_token(text)',
    'public.start_monthly_update(text)',
    'public.expire_stale_tokens()',
    'public.prepare_update_merge(uuid)',
    -- Maqola versiyalari.
    'public.create_article_revision(uuid, uuid, boolean)',
    -- Anketa (intake) oqimi.
    'public.intake_progress(uuid)',
    'public.submit_candidate_intake(uuid, uuid)',
    'public.promote_candidate_intake(uuid, uuid, boolean, text, text)',
    'public.candidate_intake_photo_is_confirmed(uuid)',
    'public.confirm_candidate_intake_photo(uuid, text, uuid, uuid, uuid)',
    'public.select_candidate_intake_photo_edit(uuid, uuid)',
    -- Koordinator CRM.
    'public.claim_coordinator_lead(uuid, uuid)',
    -- Avval qisman yopilganlar — qayta yopish zararsiz.
    'public.claim_next_publish_batch_item(uuid)',
    'public.resolve_referral_code(text)'
  ] loop
    v_fn := to_regprocedure(v_signature);
    if v_fn is null then
      raise notice 'Funksiya topilmadi, o''tkazib yuborildi: %', v_signature;
      continue;
    end if;

    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end
$$;

/*
 * NAZORAT: hali ham anon/authenticated chaqira oladigan SECURITY DEFINER
 * funksiya qoldimi?
 *
 * Migratsiyani YIQITMAYDI — jonli bazada repoda yo'q funksiya bo'lishi
 * mumkin (SQL Editor orqali qo'lda yaratilgan). U WARNING sifatida
 * chiqadi va qo'lda ko'rib chiqiladi.
 */
do $$
declare
  v_open text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname)
    into v_open
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and p.prokind = 'f'
    and p.prorettype <> 'trigger'::regtype
    and p.proname not in ('has_permission', 'is_admin', 'has_any_role', 'list_published_candidates_v2')
    and (
      has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute')
    );

  if v_open is not null then
    raise warning 'Hali ham ochiq SECURITY DEFINER funksiyalar (qo''lda ko''rib chiqing): %', v_open;
  end if;
end
$$;
