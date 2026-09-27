-- =========================================================================
-- TAHRIRIYAT RO'YXATIGA YANGI MANZIL: 8646951416
--
-- `telegram_bot.post_delivery_chat_ids` BITTA ro'yxat, lekin u TO'RTTA
-- ishni boshqaradi:
--   1. tayyor postlarni yetkazish (post-studio/pipeline.ts);
--   2. tahririyat klaviaturasi va imtiyozli amallar — nomzodlar CRM
--      ro'yxatlari, qora ro'yxat, anketa havolasi (post-studio/bot-router.ts
--      -> isEditorialChat);
--   3. sotuv operatori huquqi (sales/telegram-sales-api.ts
--      -> isSalesOperatorChat);
--   4. to'lov savollari (delivery-recipients.ts izohi).
--
-- Ya'ni bu ro'yxat AYNI PAYTDA yetkazish manzili ham, RUXSAT ro'yxati
-- hamdir. Yangi ID qo'shilishi bilan o'sha akkaunt nomzodlarning
-- shaxsiy ma'lumotlarini ko'radigan amallarga ham kirish oladi. Bu
-- ataylab tanlangan: egasi to'liq tahririyat huquqini so'radi.
--
-- ID satr ko'rinishida saqlanadi: 64-bitli chat id JSON raqamida
-- aniqligini yo'qotishi mumkin (delivery-recipients.ts 43-qator izohi).
--
-- FORWARD-ONLY VA IDEMPOTENT: mavjud qiymat O'QILADI va unga
-- qo'shiladi, ustiga yozilmaydi. Qayta ishga tushirilsa hech narsa
-- o'zgarmaydi.
-- =========================================================================

do $$
declare
  raw_value text;
  arr jsonb;
  new_id text := '8646951416';
begin
  select value into raw_value
    from public.site_settings
   where key = 'telegram_bot.post_delivery_chat_ids';

  -- Sozlama umuman yo'q: yaratamiz.
  if raw_value is null then
    insert into public.site_settings (key, value)
    values ('telegram_bot.post_delivery_chat_ids', jsonb_build_array(new_id)::text)
    on conflict (key) do nothing;
    raise notice 'sozlama yaratildi';
    return;
  end if;

  /*
   * BUZUQ QIYMATGA TEGILMAYDI.
   *
   * Kod buzuq JSON ni "bo'sh ro'yxat" deb o'qiydi, bo'sh ro'yxat esa
   * post yetkazishda "BARCHA obunachilarga" degani. Shunday qiymat
   * ustiga yozib yuborish tahririyat ro'yxatini jimgina
   * o'zgartirib qo'yardi — shuning uchun to'xtaymiz.
   */
  begin
    arr := raw_value::jsonb;
  exception when others then
    raise notice 'qiymat JSON emas — o''zgartirilmadi';
    return;
  end;

  if jsonb_typeof(arr) <> 'array' then
    raise notice 'qiymat massiv emas — o''zgartirilmadi';
    return;
  end if;

  -- Allaqachon bor: takrorlanmaydi.
  if arr @> jsonb_build_array(new_id) then
    raise notice 'ID allaqachon ro''yxatda';
    return;
  end if;

  update public.site_settings
     set value = (arr || jsonb_build_array(new_id))::text,
         updated_at = now()
   where key = 'telegram_bot.post_delivery_chat_ids';

  raise notice 'ID qo''shildi';
end $$;
