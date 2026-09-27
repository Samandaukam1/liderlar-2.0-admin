-- =========================================================================
-- TASDIQ: 8646951416 tahririyat ro'yxatida turibdimi.
--
-- NEGA ALOHIDA MIGRATSIYA: oldingi migratsiya ATAYLAB ehtiyotkor —
-- qiymat buzuq JSON yoki massiv bo'lmasa, u hech narsa qilmasdan
-- NOTICE bilan chiqib ketadi. `supabase db push` esa NOTICE larni
-- ko'rsatmaydi, ya'ni "qo'llandi" degan xabar "ID qo'shildi" degani
-- EMAS.
--
-- Bu fayl shu bo'shliqni yopadi: ID yo'q bo'lsa migratsiya YIQILADI
-- va sabab ko'rinadi. Muvaffaqiyatli o'tsa — ro'yxat haqiqatan
-- to'g'ri.
--
-- O'QISH VA TEKSHIRISH. Hech narsani o'zgartirmaydi.
-- =========================================================================

do $$
declare
  raw_value text;
  arr jsonb;
begin
  select value into raw_value
    from public.site_settings
   where key = 'telegram_bot.post_delivery_chat_ids';

  if raw_value is null then
    raise exception 'post_delivery_chat_ids sozlamasi YO''Q';
  end if;

  begin
    arr := raw_value::jsonb;
  exception when others then
    raise exception 'post_delivery_chat_ids JSON emas — ID qo''shilmagan';
  end;

  if jsonb_typeof(arr) <> 'array' then
    raise exception 'post_delivery_chat_ids massiv emas (%)', jsonb_typeof(arr);
  end if;

  if not (arr @> '["8646951416"]'::jsonb) then
    raise exception 'ro''yxatda 8646951416 YO''Q; hozirgi soni: %',
      jsonb_array_length(arr);
  end if;

  -- Faqat SON chiqadi, id lar emas: jurnalga manzil yozilmasin.
  raise notice 'tasdiqlandi: ro''yxatda % ta manzil bor', jsonb_array_length(arr);
end $$;
