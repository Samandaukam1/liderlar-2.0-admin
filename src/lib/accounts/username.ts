/**
 * LOGIN (USERNAME) QOIDALARI — SOF MODUL.
 *
 * Nomzod akkauntni faollashtirganda email so'ralmaydi: u o'ziga
 * login tanlaydi va tizimga "login + parol" bilan kiradi.
 *
 * REGISTRGA SEZGIR EMAS. "AsadbekAzamov" va "asadbekazamov" —
 * bitta login. Aks holda ikki odam ko'zga bir xil ko'rinadigan
 * ikki hisob ochib, bir-birining o'rniga chiqishi mumkin edi.
 *
 * NUSXA: aynan shu fayl admin repozitoriysida ham bor. Ikki repo
 * alohida deploy qilinadi va umumiy paket yo'q — bu loyihada
 * o'rnashgan yo'l. O'zgartirilsa, IKKALASI ham.
 */

export const USERNAME_MIN_LENGTH = 4;
export const USERNAME_MAX_LENGTH = 30;

/**
 * Saqlanadigan va solishtiriladigan shakl.
 *
 * Kichik harf: yagonalik indeksi ham `lower(username)` bo'yicha,
 * ya'ni ikkovi bir xil qoidaga tayanadi.
 */
export function normalizeUsername(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

/**
 * RUXSAT ETILGAN BELGILAR.
 *
 * Lotin harflari, raqamlar, ostki chiziq va nuqta. Nuqta
 * kiritilgan, lekin BOSHIDA, OXIRIDA yoki ketma-ket kelmaydi:
 * "a..b" va "a.b" ko'zga bir xil ko'rinadi va bu o'zini boshqa
 * odam qilib ko'rsatishga yo'l ochardi.
 */
const SHAPE = /^[a-z0-9](?:[a-z0-9_]|\.(?!\.))*[a-z0-9_]$/;

export type UsernameProblem =
  | "empty"
  | "too_short"
  | "too_long"
  | "shape"
  | "reserved";

export const USERNAME_PROBLEM_TEXT: Record<UsernameProblem, string> = {
  empty: "Login yozing.",
  too_short: `Login kamida ${USERNAME_MIN_LENGTH} belgidan bo'lsin.`,
  too_long: `Login ${USERNAME_MAX_LENGTH} belgidan oshmasin.`,
  shape:
    "Loginda faqat lotin harflari, raqamlar, _ va . bo'lsin. Bo'shliq va boshqa belgi bo'lmaydi.",
  reserved: "Bu login band. Boshqa login tanlang.",
};

export interface UsernameCheck {
  ok: boolean;
  /** Saqlashga tayyor shakl. */
  username: string;
  problem?: UsernameProblem;
}

/**
 * Shaklni tekshiradi.
 *
 * BANDLIK BU YERDA TEKSHIRILMAYDI — u bazaga tegadi va sof
 * modulda bo'lishi mumkin emas. Bu funksiya faqat "shakl
 * to'g'rimi" degan savolga javob beradi.
 */
export function checkUsernameShape(
  input: string | null | undefined,
  reserved: ReadonlySet<string> = new Set(),
): UsernameCheck {
  const username = normalizeUsername(input);

  if (username === "") return { ok: false, username, problem: "empty" };
  if (username.length < USERNAME_MIN_LENGTH) {
    return { ok: false, username, problem: "too_short" };
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return { ok: false, username, problem: "too_long" };
  }
  if (!SHAPE.test(username)) return { ok: false, username, problem: "shape" };

  /*
   * BAND QILINGAN NOM "shakl xatosi" EMAS, "band" deb aytiladi.
   *
   * "admin" nomi texnik jihatdan to'g'ri; muammo uning kimgaligida.
   * Sababni aniq aytmaslik ham ataylab: ro'yxatni oshkor qilmaymiz.
   */
  if (reserved.has(username)) return { ok: false, username, problem: "reserved" };

  return { ok: true, username };
}

/* ========================================================================= *
 * KIRISHDAGI IDENTIFIKATOR
 * ========================================================================= */

/**
 * Kiritilgan matn email ko'rinishidami.
 *
 * Eski foydalanuvchilar email bilan kiradi, yangilari login
 * bilan. Qaysi biri ekanini shakl hal qiladi: login tarkibida
 * "@" bo'lishi mumkin emas, ya'ni chalkashish yo'q.
 */
export function looksLikeEmail(input: string | null | undefined): boolean {
  const value = (input ?? "").trim();
  return value.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * ICHKI AUTH MANZILI.
 *
 * Supabase Auth parol bilan kirish uchun email talab qiladi,
 * foydalanuvchidan esa email so'ralmaydi. Shuning uchun har
 * login hisobiga ko'rinmaydigan manzil beriladi.
 *
 * MANZIL LOGINDAN KELTIRIB CHIQARILMAYDI. Agar u
 * "<login>@..." bo'lganida, loginni o'zgartirish autentifikatsiya
 * shaxsini ham o'zgartirishni talab qilardi — bu esa parolni va
 * sessiyalarni xavf ostiga qo'yadi. Tasodifiy identifikator
 * loginni auth'dan butunlay ajratadi.
 */
export const INTERNAL_AUTH_DOMAIN = "users.liderlar.uz";

export function isInternalAuthEmail(email: string | null | undefined): boolean {
  return (email ?? "").toLowerCase().endsWith(`@${INTERNAL_AUTH_DOMAIN}`);
}

/**
 * Foydalanuvchiga ko'rsatiladigan email.
 *
 * Ichki manzil HECH QACHON chiqmaydi: u foydalanuvchining emaili
 * emas va uni ko'rsatish "sizning emailingiz shu" degan yolg'on
 * bo'lardi.
 */
export function displayEmail(email: string | null | undefined): string | null {
  const value = (email ?? "").trim();
  if (value === "" || isInternalAuthEmail(value)) return null;
  return value;
}
