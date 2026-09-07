/**
 * Sotuv ssenariysining XABAR SHABLONLARI.
 *
 * NEGA BITTA JOYDA: bu matnlar komponent ichiga sochilsa, ularni
 * tahrirlash kod deployini talab qilardi va ikki joyda ikki xil
 * variant paydo bo'lishi muqarrar edi.
 *
 * `is_exact: true` — matn AI TOMONIDAN QAYTA YOZILMAYDI. Sotuv
 * ssenariysining bu qismlari huquqiy va narx ma'lumotini o'z ichiga
 * oladi; model ularni "yaxshilashi" mumkin emas.
 *
 * IMLO: quyidagi matnlar buyurtmachi bergan ko'rinishda, HARF-BAHARF
 * saqlangan. Ba'zi joyda imlo xatosi bor va u ATAYLAB tuzatilmagan —
 * "aynan yuborilsin" talabi shuni anglatadi. Tuzatish kerak bo'lsa
 * admin panelidagi shablon tahririda qilinadi, kodda emas.
 *
 * Bu fayl `sales_message_templates` jadvalining SEED manbasi. Ikkisi
 * ajralib ketmasligi uchun test ularni harfma-harf solishtiradi.
 */

export interface SalesTemplate {
  key: string;
  title: string;
  body: string;
  /** true — AI qayta yozmaydi, aynan shu matn ketadi. */
  isExact: boolean;
}

export const SALES_TEMPLATES: readonly SalesTemplate[] = [
  {
    key: "application_confirm",
    title: "Salomlashish va ariza tasdig‘i",
    isExact: true,
    body: `Vaalaykum assalom.
Siz “O‘zbekiston Lider Yoshlari Ensiklopediyasi”ga kirish uchun ariza qoldirgansiz. Shunaqami?`,
  },
  {
    key: "benefits_question",
    title: "Foydalar haqida bilasizmi",
    isExact: true,
    body: `Siz ensiklopediyamizga kirishning foydali jihatlari haqida batafsil ma’lumotga egamisiz?`,
  },
  {
    key: "understood",
    title: "Tushunarli",
    isExact: true,
    body: `Tushunarli.`,
  },
  {
    key: "benefits_full",
    title: "Foydalar (to‘liq matn)",
    isExact: true,
    body: `Ushbu xabarda sizga qo‘shimcha ma’lumotlarni taqdim etmoqdamiz.
Ensiklopediyaga istalgan sohada faoliyat yuritayotgan, o‘z ustida ishlayotgan yoshlar qabul qilinadi.
Bu loyiha yoshlarning yutuqlarini hujjatlashtirish, ularni ommaga tanitish va boshqalarga ilhom manbai bo‘lish maqsadida yaratilgan.

✅ Qidiruv tizimlarida ko‘rinish:
Siz haqingizdagi maqola Google, Yandex, Bing kabi qidiruv tizimlarida chiqadi. Bu sizni istagan odam — hamkor, ish beruvchi yoki jurnalist — osongina topishi mumkinligini anglatadi.

✅ Sun’iy intellekt platformalarida tanilish:
ChatGPT, Copilot, Gemini kabi sun’iy intellekt tizimlari endilikda siz haqingizda aniq manbalarga tayangan holda ma’lumot bera oladi. Bu sizning onlayn obro‘yingizni mustahkamlovchi kuchli vosita.

✅ Kelajakdagi Wikipedia sahifangiz uchun asos:
Bugun e’lon qilinadigan maqola — ertaga siz haqingizda yoziladigan Wikipedia sahifasi uchun tayyor ishonchli manba bo‘lishi mumkin.

✅ AdabiyotX platformasidagi eksklyuziv imkoniyatlar:
AdabiyotX platformasi orqali birinchi kitobingiz, maqolangiz yoki boshqa mualliflik materiallaringizni mutlaqo bepul nashr etishingiz mumkin. Asaringiz platformada kitobxonlarga taqdim etiladi va har bir sotuvdan mualliflik daromadi olish imkoniyatiga ega bo‘lasiz.

✅ Ijtimoiy tarmoqlarda tasdiq belgisi olish imkoniyati:
Instagram, Facebook, TikTok, YouTube kabi platformalarda ko‘k nishon olish uchun siz haqingizda onlayn nashrlar zarur. Ushbu maqola bu yo‘lda ishonchli hujjat bo‘lib xizmat qiladi.

✅ Rezumega qo‘shiladigan rasmiy havola:
Ish qidirishda, grantga hujjat topshirishda yoki xalqaro loyihalarda qatnashishda ushbu maqola — sizning shaxsiy brendingizni isbotlovchi kuchli hujjat bo‘ladi.

✅ Xorijiy universitetlar va dasturlar va stependiyalar uchun tavsiyanoma:
Xorijiy universitetlar, grant dasturlari, almashinuv loyihalari va xalqaro tanlovlar, stependiyalar uchun tashkilot yoki rahbar nomidan universal yoki maxsus tavsiyanoma (Recommendation Letter) tayyorlash xizmatidan foydalanishingiz mumkin. Har bir tavsiyanoma sizning yutuqlaringiz, faoliyatingiz va maqsadlaringiz asosida professional tarzda tayyorlanadi.

✅ Lider yoshlar online jurnalida yoritilish
Biografik maqolasi bor yoshlar Lider yoshlar online jurnalida mumtazam yoritiladi. Ularning hayotida yuz bergan muhim voqea, ularning loyihalari va tashabburlari keng targ'ib qilinadi.

✅ Ommaviy axborot vositalari e’tiboriga tushasiz:
Jurnalistlar, blogerlar, televideniye va radio uchun maqolaviy manba sifatida sizga murojaatlar ko‘payadi.

✅ Liderlar iqtibosida faollik
Har qanday jamiyat uchun kerakli va mamunli go'yangizni Liderlardan iqtiboslar ruknida e'lon qilishingiz mumkin bo'ladi

✅ Shaxsiy brendingiz uchun poydevor:
Har qanday lider, ekspert yoki jamoat faoli uchun shaxsiy brend muhim. Bu maqola — o‘zingizga bo‘lgan ishonchni va boshqalarning sizga nisbatan ishonchini mustahkamlaydi.

✅ Project Found dasturi imkoniyatlari:
Project Found dasturi orqali startap, loyiha yoki tashabbusingiz uchun mutlaqo bepul zamonaviy va professional veb-saytga ega bo‘lish imkoniyatini qo‘lga kiriting.

✅ Kelajak loyihalarda e’tibor markazida bo‘lish:
Tanlovlar, forumlar, konferensiyalar yoki grant dasturlarida qatnashishda siz haqingizdagi onlayn maqola sizni ajratib ko‘rsatadi.

✅ Ensiklopediyaga kirganlik haqida sertifikat
Tanlovlar, forumlar, konferensiyalar yoki grant dasturlarida qatnashishda, yoki talaba bo'lsangiz "kontraktddan grantaga o'tishda" ijtimoiy faollikka kiritish uchun yutuqlar jildiga munosib tashakkurnomaga ega bo'lasiz.

Ensiklopeidyamizning ommaviy ofertasi bilan quyidagi link orqali batafsil tanishishiniz mumkin !
https://liderlar.uz/ommaviy_ofertasi

Liderlar.uz | Instagram | @uzlye_rasmiy`,
  },
  {
    key: "benefits_review_prompt",
    title: "Oferta bilan tanishishga chorlov",
    isExact: true,
    body: `Unda xabar va linkdagi ommaviy ofertamiz bilan tanishib chiqib ayting.`,
  },
  {
    key: "price_offer",
    title: "Narx taklifi",
    isExact: true,
    body: `Oldindan aytaman Bizda maqola joylashning yillik badali bor va u hozirda 100 000 so’mni tashkil qiladi.

LEKIN HOZIRDA YANGI O"QUV YILI BOSHLANISHI MUNOSABATI BILAN MEGA CHEGIRMA AMAL QILMOQDA VA KIRISH BADALI ATIGA 38 MING SO'M.

Pullar saytni va maqolalarni texnik jihatdan ta’minlaydi va sifatli yuritilishiga va saqlanishiga sarflanadi Kelajakda, biror bir yangi loyiha qilsangiz, yoki o’zgrartirish kerak bo’lsa bir yil ichida bu xizmatlar bepul boʻladi Undan tashqari kelajakda turli semenar, podcastlar va reels videolar qilishni rejalayapmiz. Bu ishlarda ham albatta ensiklopediyamizga kirgan nomzodlarning virtual imidjini yaxshilash uchun harakat qilamiz jumaladan sizning ham!`,
  },
  {
    key: "review_later",
    title: "Tanishib bo‘lgach ayting",
    isExact: true,
    body: `Tanishib bo‘lgach ayting.`,
  },
  {
    key: "article_decision",
    title: "Maqola yozamizmi",
    isExact: true,
    body: `Maqulmi sizga, sizga ham biografik maqola yozamizmi?`,
  },
  {
    key: "request_full_name",
    title: "F.I.Sh. so‘rash",
    isExact: true,
    body: `Yaxshi unda menga isminigizni to'liq yozib yuboring men sizga maxsus savollar xabarnomasini yuboraman . siz javoblar yozib yuboraisz havolarni ichiga kirib
javoblaringiz asosida biografik maqolangizni shakillantiramiz`,
  },
  {
    key: "request_full_name_again",
    title: "To‘liq F.I.Sh. qayta so‘rash",
    isExact: true,
    body: `To‘liq F.I.Sh.ingizni yozib yuboring.`,
  },
  {
    key: "intake_instructions",
    title: "Anketa havolasi ko‘rsatmasi",
    isExact: true,
    body: `LINKni imkon qadar tezroq toldiirb javoblarni yuboring u vaqtinchalik link va tahiman bir necha soatda yaroqsiz boladi

Rasm AYNAN linkdagi birinchi sahifadagi promt bilan yaratilishi shart

promtni nusxalang va rasmingiz bilan birga ChatGPT yoki Gemini’ga bering. Tayyor natijani yuqoridagi «Rasm yuklash» tugmasi orqali joylang.

Boshqa usulda tayyorlangan yoki oddiy rasm qabul qilinmaydi — bunday holatda maqola chiqarilmaydi.`,
  },
  {
    key: "intake_submitted_ack",
    title: "Anketa to‘ldirilgani tasdig‘i",
    isExact: true,
    body: `Javoblarni to‘ldiribsiz.`,
  },
  {
    key: "payment_details",
    title: "To‘lov ma’lumotlari",
    isExact: true,
    body: `💳 To‘lov uchun karta ma’lumoti:
Uzcard: 5614686500416261

Karta egasi: JAXONGIR QURBONNAZAROV
✅ To‘lovni amalga oshirgach, iltimos, chek (skrinshot)ni bizga yuboring.

Liderlar.uz | Instagram | @uzlye_rasmiy

CHEGIRMADAGI 38 MING SO'M TO'LOVNI SHU HISOB RAQAMGA YUBORING`,
  },
  {
    key: "payment_note",
    title: "To‘lov izohi",
    isExact: true,
    body: `To‘lovni hozir amalga oshirsangiz, chek kelgandan so‘ng maqolangizni nashrga yuborishni tasdiqlaymiz.`,
  },
  {
    key: "payment_received",
    title: "Chek qabul qilindi",
    isExact: true,
    body: `Chek qabul qilindi, tekshirib chiqamiz va tasdiqlagach xabar beramiz.`,
  },
  {
    key: "declined",
    title: "Rad javobi",
    isExact: true,
    body: `Yaxshi, fikringiz o‘zgarsa shu yerda bo‘lamiz.`,
  },
  {
    key: "followup_offer_review",
    title: "Follow-up: tanishib chiqdingizmi (7 daqiqa)",
    isExact: true,
    body: `Tanishib chiqdingizmi?`,
  },
  {
    key: "followup_article_decision",
    title: "Follow-up: maqola yozamizmi (5 daqiqa)",
    isExact: true,
    body: `Maqulmi sizga, sizga ham biografik maqola yozamizmi?`,
  },
  {
    key: "followup_article_decision_later",
    title: "Follow-up: nima qilamiz (1 soat)",
    isExact: true,
    body: `Nima qilamiz, maqola yozamizmi?`,
  },
];

const BY_KEY = new Map(SALES_TEMPLATES.map((template) => [template.key, template]));

export function getTemplate(key: string): SalesTemplate | null {
  return BY_KEY.get(key) ?? null;
}

export const SALES_TEMPLATE_KEYS: readonly string[] = SALES_TEMPLATES.map((t) => t.key);

/** Follow-up turi -> yuboriladigan shablon. */
export const FOLLOWUP_TEMPLATES: Readonly<Record<string, string>> = {
  offer_review: "followup_offer_review",
  article_decision: "followup_article_decision",
  article_decision_later: "followup_article_decision_later",
};
