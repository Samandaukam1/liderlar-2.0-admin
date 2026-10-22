/**
 * Bitta rasmni bir nechta chatga yuborish — SOF modul (I/O tashqaridan beriladi).
 *
 * Rasm avval URL sifatida beriladi: post asseti ochiq bucket'da turadi va
 * Telegram uni o'zi olib keladi. Birinchi muvaffaqiyatli yuborishdan keyin
 * qolgan chatlarga Telegram'ning o'z `file_id` si beriladi — u rasmni
 * qayta yuklamaydi.
 *
 * NEGA ZAXIRA YO'L BOR: 2026-10 da 8 ta post uchun "kanalga qo'yildimi?"
 * eslatmasi 16 kun davomida har 3 soatda yiqildi — Telegram "failed to get
 * HTTP URL content" qaytardi, holbuki o'sha havolalar 200 va boshqa
 * postlarning aynan shunday rasmlari o'tib turardi. Telegram ma'lum bir
 * URL'ni ololmasa, xato o'sha URL'ga yopishib qoladi. Shuning uchun bunday
 * rad javobida rasm baytlari o'zimiz yuklab olinadi va to'g'ridan-to'g'ri
 * yuboriladi — bir marta, keyingi chatlar yana `file_id` ni oladi.
 */

/** Telegram URL'dagi rasmni o'zi ololmaganini bildiradigan javoblar. */
const URL_FETCH_FAILURE =
  /failed to get HTTP URL content|wrong file identifier\/HTTP URL specified|wrong type of the web page content/i;

export function isUrlFetchFailure(err: unknown): boolean {
  return err instanceof Error && URL_FETCH_FAILURE.test(err.message);
}

export interface PhotoFanoutDeps {
  send(chatId: number, photo: Buffer | string): Promise<{ fileId: string | null }>;
  /** Rasm baytlarini o'zimiz olamiz — faqat Telegram URL'ni rad etganda. */
  download(url: string): Promise<Buffer>;
}

export interface PhotoFanoutResult {
  sent: number;
  errors: { chatId: number; message: string }[];
}

export async function sendPhotoToChats(
  chatIds: readonly number[],
  url: string,
  deps: PhotoFanoutDeps,
): Promise<PhotoFanoutResult> {
  const result: PhotoFanoutResult = { sent: 0, errors: [] };
  let photo: Buffer | string = url;
  // undefined — hali urinilmagan; null — yuklab bo'lmadi, qayta urinilmaydi.
  let bytes: Buffer | null | undefined;

  for (const chatId of chatIds) {
    try {
      let sent: { fileId: string | null };
      try {
        sent = await deps.send(chatId, photo);
      } catch (err) {
        if (photo !== url || !isUrlFetchFailure(err) || bytes === null) throw err;
        if (bytes === undefined) {
          try {
            bytes = await deps.download(url);
          } catch (downloadErr) {
            bytes = null;
            throw downloadErr;
          }
        }
        photo = bytes;
        sent = await deps.send(chatId, photo);
      }
      photo = sent.fileId ?? photo;
      result.sent += 1;
    } catch (err) {
      result.errors.push({ chatId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
