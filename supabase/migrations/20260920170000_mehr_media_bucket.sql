-- ============================================================
-- MEHR 365+ — DALIL MEDIASI UCHUN BUCKET
--
-- OMMAVIY BUCKET, ATAYLAB.
--
-- Tasdiqlangan ezgulik ishining rasmlari ommaviy hikoyada
-- ko'rsatiladi (§7). Ularni yopiq bucketda saqlab, har bir
-- ko'rish uchun imzolangan havola yasash — har sahifa
-- ochilishida o'nlab qo'shimcha so'rov degani.
--
-- Nima OMMAVIY EMASLIGI esa boshqa joyda hal qilinadi:
-- tadbirning o'zi 'approved' bo'lmaguncha, uning yo'li hech
-- qayerda chop etilmaydi va `mehr_media` qatorlari RLS bilan
-- yopiq turadi. Ya'ni rasm manzilini bilmasdan topib
-- bo'lmaydi.
--
-- Shu sababli bu yerga SHAXSIY hujjat yuklanmaydi — faqat
-- tadbir fotolari.
-- ============================================================

insert into storage.buckets (id, name, public) values
  ('mehr-media', 'mehr-media', true)
on conflict (id) do update set public = excluded.public;

/*
 * O'QISH — ochiq.
 *
 * Mavjud "public buckets are readable" siyosati bucketlarni
 * qattiq ro'yxat bilan sanaydi, shuning uchun yangisi uchun
 * alohida siyosat kerak.
 */
drop policy if exists "mehr media is readable" on storage.objects;
create policy "mehr media is readable"
  on storage.objects for select
  using (bucket_id = 'mehr-media');

/*
 * YOZISH — FAQAT SERVER.
 *
 * Mijozga to'g'ridan-to'g'ri yuklash berilmaydi: fayl turi,
 * hajmi va kimga tegishliligi server tomonda tekshirilishi
 * kerak. Service role RLS'ni chetlab o'tadi, shuning uchun
 * bu yerda insert/update siyosati ATAYLAB yo'q.
 */
