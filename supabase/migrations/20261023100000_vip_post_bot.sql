-- =========================================================================
-- POST BOT: VIP BERISH — FAOLLASHTIRISH HAVOLASI BILAN OLDINDAN VIP
--
-- Muharrir post botda nomzodni topadi va ikki yo'ldan birini tanlaydi:
--
--   · akkaunti HALI YO'Q nomzod — faollashtirish havolasi +1/+2/+3 oy VIP
--     bilan (yoki VIPsiz). VIP hozir berilmaydi: nomzodning profili yo'q,
--     `vip_grant_days()` esa profilga yozadi. U shu havolaga "kutib turgan
--     VIP" bo'lib yoziladi va nomzod AYNAN SHU havola orqali akkauntini
--     ochgan zahoti yoqiladi — muddat o'sha lahzadan hisoblanadi;
--   · akkaunti BOR nomzod — VIP darhol `vip_grant_days()` orqali beriladi
--     (faol bo'lsa tugash sanasidan uzaytiriladi, tugagan bo'lsa qayta yoqiladi).
--
-- NEGA TRIGGER: havola ommaviy saytda (liderlar-web, alohida loyiha)
-- ishlatiladi. VIP bazada, nomzod akkauntga bog'langan tranzaksiyaning
-- o'zida yoqiladi — qaysi ilova bog'lagani ahamiyatsiz va "akkaunt ochildi,
-- VIP esa keyinroq" oralig'i bo'lmaydi.
--
-- BOG'LASHNI HECH QACHON YIQITMAYDI: VIP yozilmasa ham akkaunt ochiladi,
-- xato `last_error` ga yoziladi va soatlik `vip-expiry` cron'i
-- `vip_apply_pending_grants()` ni qayta chaqiradi (idempotent kalit bilan).
--
-- FORWARD-ONLY.
-- =========================================================================

create table if not exists public.vip_pending_grants (
  id uuid primary key default gen_random_uuid(),

  candidate_id uuid not null references public.candidates(id) on delete cascade,
  -- VIP HAVOLAGA bog'langan, nomzodga emas: yangi havola eskisini bekor
  -- qiladi (`createActivation`), bekor qilingan havolaning VIP'i esa
  -- hech qachon qo'llanmaydi — ya'ni har havola o'z tanlovini olib yuradi.
  activation_id uuid not null unique references public.candidate_activations(id) on delete cascade,

  days integer not null check (days between 1 and 3650),

  granted_by_telegram_id bigint not null,
  granted_by_name text check (granted_by_name is null or length(granted_by_name) <= 120),

  created_at timestamptz not null default now(),

  applied_at timestamptz,
  applied_profile_id uuid references public.profiles(id) on delete set null,
  applied_grant_id uuid,
  last_error text
);

create index if not exists idx_vip_pending_grants_open
  on public.vip_pending_grants (candidate_id)
  where applied_at is null;

comment on table public.vip_pending_grants is
  'Post bot: faollashtirish havolasiga biriktirilgan VIP. Nomzod shu havola '
  'orqali akkauntini ochganda vip_apply_pending_grants() uni yoqadi.';

alter table public.vip_pending_grants enable row level security;
revoke insert, update, delete, truncate on table public.vip_pending_grants from anon, authenticated;

drop policy if exists "admins read vip pending grants" on public.vip_pending_grants;
create policy "admins read vip pending grants"
  on public.vip_pending_grants for select
  to authenticated
  using (public.has_permission('vip.view'));

/* ====================================================================== *
 * BIR KARTA — BIR AMAL
 *
 * Telegram tugmasi sekin javob bersa, odam uni yana bosadi. VIP berish va
 * havola yaratish ikki marta bajarilmasligi kerak: ikkinchi havola birinchisini
 * bekor qiladi va muharrir bekor qilingan havolani yuborib qo'yishi mumkin edi.
 * Birinchi bosish shu jadvalga qator qo'yadi, ikkinchisi unikal kalitga uriladi.
 * ====================================================================== */

create table if not exists public.vip_bot_card_actions (
  chat_id bigint not null,
  message_id bigint not null,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  action text not null check (char_length(action) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

alter table public.vip_bot_card_actions enable row level security;
revoke insert, update, delete, truncate on table public.vip_bot_card_actions from anon, authenticated;

/* ====================================================================== *
 * QO'LLASH
 * ====================================================================== */

create or replace function public.vip_apply_pending_grants(p_candidate_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_result jsonb;
  v_applied integer := 0;
begin
  for r in
    select g.id, g.days, g.granted_by_telegram_id, g.granted_by_name, c.user_id
      from public.vip_pending_grants g
      join public.candidate_activations a on a.id = g.activation_id
      join public.candidates c on c.id = g.candidate_id
     where g.applied_at is null
       and (p_candidate_id is null or g.candidate_id = p_candidate_id)
       and c.user_id is not null
       and c.deleted_at is null
       -- Faqat SHU havola ishlatilgan bo'lsa va uni ishlatgan odam bog'langan bo'lsa.
       and a.consumed_at is not null
       and a.consumed_by_user_id = c.user_id
     order by g.created_at
     for update of g skip locked
  loop
    begin
      v_result := public.vip_grant_days(
        r.user_id,
        r.days,
        'admin',
        'post_bot:' || r.granted_by_telegram_id,
        'post-bot-pending:' || r.id,
        null,
        'Post bot: faollashtirish havolasi bilan ' || r.days || ' kun VIP'
          || coalesce(' (' || r.granted_by_name || ')', '')
      );
      update public.vip_pending_grants
         set applied_at = now(),
             applied_profile_id = r.user_id,
             applied_grant_id = nullif(v_result ->> 'grant_id', '')::uuid,
             last_error = null
       where id = r.id;
      v_applied := v_applied + 1;
    exception when others then
      update public.vip_pending_grants
         set last_error = left(sqlerrm, 500)
       where id = r.id;
    end;
  end loop;

  return v_applied;
end;
$$;

revoke all on function public.vip_apply_pending_grants(uuid) from public, anon, authenticated;
grant execute on function public.vip_apply_pending_grants(uuid) to service_role;

create or replace function public.candidates_apply_pending_vip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.vip_apply_pending_grants(new.id);
  exception when others then
    -- Akkaunt baribir ochiladi; VIP'ni soatlik cron qayta urinadi.
    raise warning 'Kutib turgan VIP qo''llanmadi (nomzod %): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.candidates_apply_pending_vip() from public, anon, authenticated;

drop trigger if exists trg_candidates_apply_pending_vip on public.candidates;
create trigger trg_candidates_apply_pending_vip
  after update of user_id on public.candidates
  for each row
  when (old.user_id is null and new.user_id is not null)
  execute function public.candidates_apply_pending_vip();
