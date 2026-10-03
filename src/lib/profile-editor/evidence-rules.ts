/**
 * SERTIFIKAT DALILI — SOF QOIDALAR (§8).
 *
 * IKKALA REPODA AYNAN BIR XIL (`liderlar-web` yuklaydi va egasiga
 * ko'rsatadi, `liderlar-admin` tahririyatga ko'rsatadi). Test ikki
 * nusxani solishtiradi. Hech narsa import qilinmaydi — fayl testda
 * `node --test` bilan to'g'ridan-to'g'ri o'qiladi.
 *
 * Bucket YOPIQ: fayl manzili hech qachon sahifaga chiqmaydi, faqat
 * server bergan 60 soniyalik imzolangan havola.
 */

export const EVIDENCE_BUCKET = "certificate-evidence";

/** 10 MB — bucketdagi `file_size_limit` bilan bir xil. */
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

/** Imzolangan havolaning umri, soniyada. */
export const EVIDENCE_LINK_SECONDS = 60;

/** Ruxsat etilgan tur -> kengaytma. Bucketdagi `allowed_mime_types` bilan bir xil. */
export const EVIDENCE_TYPES: Readonly<Record<string, "pdf" | "jpg" | "png" | "webp">> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const EVIDENCE_ACCEPT = Object.keys(EVIDENCE_TYPES).join(",");

export const EVIDENCE_TYPE_ERROR = "PDF, JPG, PNG yoki WebP fayl tanlang (10 MB gacha).";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * Tur -> kengaytma, faqat ruxsat etilgan turlar uchun.
 *
 * `EVIDENCE_TYPES[mime]` to'g'ridan-to'g'ri o'qilmaydi: `"constructor"`
 * kabi qiymat obyektning o'z xossasini emas, prototipdagi funksiyani
 * qaytarardi va u "kengaytma" bo'lib yo'lga tushardi.
 */
export function evidenceExtension(mime: unknown): "pdf" | "jpg" | "png" | "webp" | null {
  return typeof mime === "string" && Object.hasOwn(EVIDENCE_TYPES, mime) ? EVIDENCE_TYPES[mime] : null;
}

/** Brauzer aytgan tur va hajm qoidaga mosmi. Yakuniy tekshiruv emas — u fayl baytlarida. */
export function validEvidenceMeta(mime: unknown, size: unknown): boolean {
  return (
    evidenceExtension(mime) !== null &&
    typeof size === "number" &&
    Number.isInteger(size) &&
    size > 0 &&
    size <= EVIDENCE_MAX_BYTES
  );
}

/**
 * Faylning bucketdagi yo'li.
 *
 * candidates/<nomzod>/<sertifikat>/<tasodifiy-uuid>.<ext>
 *
 * SERVERDA YASALADI — brauzerdan yo'l qabul qilinmaydi: aks holda
 * odam boshqa nomzodning papkasiga yozishi yoki `../` yuborishi
 * mumkin edi. Bazadagi CHECK ham xuddi shu shaklni talab qiladi.
 */
export function buildEvidencePath(
  candidateId: string,
  certificateId: string,
  fileId: string,
  mime: string,
): string | null {
  const ext = evidenceExtension(mime);
  if (!ext || !isUuid(candidateId) || !isUuid(certificateId) || !isUuid(fileId)) return null;
  return `candidates/${candidateId.toLowerCase()}/${certificateId.toLowerCase()}/${fileId.toLowerCase()}.${ext}`;
}

/**
 * Brauzer qaytargan yo'l AYNAN shu nomzod va shu sertifikatnikimi.
 *
 * Yuklash ikki qadamli: imzo -> yuklash -> tasdiqlash. Tasdiqlashda
 * yo'l brauzerdan qaytib keladi va u almashtirilgan bo'lishi mumkin.
 */
export function validEvidencePath(
  path: unknown,
  candidateId: string,
  certificateId: string,
): path is string {
  if (typeof path !== "string" || !isUuid(candidateId) || !isUuid(certificateId)) return false;
  const prefix = `candidates/${candidateId.toLowerCase()}/${certificateId.toLowerCase()}/`;
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  const match = /^([0-9a-f-]{36})\.(pdf|jpg|png|webp)$/.exec(name);
  return match !== null && isUuid(match[1]);
}

/**
 * Fayl mazmuni e'lon qilingan turga mosmi — "sehrli baytlar".
 *
 * Tur brauzerdan keladi va unga ishonib bo'lmaydi: HTML yoki
 * skriptni `image/png` deb yuklash mumkin. Imzo tekshirilmasa, u
 * tahririyat xodimining brauzerida ochilardi.
 */
export function matchesEvidenceBytes(bytes: Uint8Array, mime: string): boolean {
  // Imzodan qisqa fayl hech bir turga mos kelmaydi.
  if (bytes.length < 4) return false;
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(start, end)));

  switch (mime) {
    case "application/pdf":
      return /^%PDF-(1\.[0-7]|2\.0)/.test(ascii(0, 8));
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value,
      );
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    default:
      return false;
  }
}

/** Yuklab olinganda fayl nomi — ichki yo'l yoki uuid ko'rsatilmaydi. */
export function evidenceDownloadName(mime: string): string {
  return `sertifikat-dalili.${evidenceExtension(mime) ?? "bin"}`;
}

/** Ro'yxatda ko'rsatish uchun: "PDF · 1,2 MB". */
export function describeEvidence(mime: string, sizeBytes: number): string {
  const kind = mime === "application/pdf" ? "PDF" : "Rasm";
  const megabytes = sizeBytes / (1024 * 1024);
  const size =
    megabytes >= 1
      ? `${megabytes.toFixed(1).replace(".", ",")} MB`
      : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  return `${kind} · ${size}`;
}
