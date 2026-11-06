# AdabiyotX hisobini bog'lash va o'qilgan kitoblar

Qarang: `src/lib/adabiyotx/partner-core.ts` (shartnoma), `partner-service.ts` (baza), `src/app/api/public/adabiyotx/*`.

- Migratsiyalar: `20261106120000_adabiyotx_account_links.sql` (`db push`), `20261106121000_ranking_adabiyotx_reads.sql`
  (`supabase db query --linked -f …`, so'ng `select public.recalculate_rankings();`).
- Muhit: `ADABIYOTX_PARTNER_API_BASE_URL=https://adabiyotx-admin.vercel.app`, `ADABIYOTX_INTEGRATION_API_KEY`, `LIDERLAR_PUBLIC_CONTENT_API_KEY`.
- Testdan o'tgan kitoblar `candidate_adabiyotx_items` ga `read_book` (metadata.source = adabiyotx_quiz, quizScore),
  muallif kitoblari `own_work` (metadata.source = adabiyotx_sync) sifatida yoziladi — admin paneldagi nomzod
  sahifasi va ommaviy biografiya ularni o'zi ko'rsatadi. Ball: `adabiyotx_book_reads.score` (har to'g'ri javob 1).
- To'liq hujjat: adabiyot-ai-admin/docs/LIDERLAR-INTEGRATSIYA.md
