/**
 * Joy tekshiruvi — SOF MODUL.
 *
 * Faqat tadbir paytida, faqat ruxsat bilan va faqat "yaqinmi?"
 * degan savolga javob berish uchun (§24). Doimiy kuzatuv YO'Q:
 * bazaga koordinata emas, MASOFA yoziladi.
 */

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Ikki nuqta orasidagi masofa (metr), haversine. */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h))));
}

export interface LocationCheckInput {
  requiresLocation: boolean;
  event: { latitude: number | null; longitude: number | null; radiusMeters: number | null };
  reported: { latitude: number; longitude: number; accuracyMeters?: number } | null;
}

export type LocationCheck =
  | { ok: true; verified: boolean; distanceMeters: number | null; reason: "not_required" | "within_radius" }
  | { ok: false; reason: "location_missing" | "too_far" | "event_has_no_location"; distanceMeters: number | null };

/**
 * ONLAYN TADBIR — JOYSIZ.
 *
 * Har bir ezgulik ishi jismoniy bo'lavermaydi. Joy majburiy
 * qilinsa, masofadan qilingan haqiqiy ish ham rad etilardi.
 */
export function checkLocation(input: LocationCheckInput): LocationCheck {
  if (!input.requiresLocation) {
    return { ok: true, verified: false, distanceMeters: null, reason: "not_required" };
  }

  const { latitude, longitude, radiusMeters } = input.event;
  if (latitude === null || longitude === null || radiusMeters === null) {
    return { ok: false, reason: "event_has_no_location", distanceMeters: null };
  }

  if (!input.reported) {
    return { ok: false, reason: "location_missing", distanceMeters: null };
  }

  const distance = distanceMeters({ latitude, longitude }, input.reported);

  /*
   * GPS ANIQLIGI HISOBGA OLINADI.
   *
   * Telefon "men shu yerdaman, xatolik ±40 m" deydi. Bu yon
   * berilmasa, binoning ichida turgan odam derazaga yaqin
   * turgani uchun rad etilishi mumkin edi. Aniqlikka yon berish
   * cheksiz emas: juda katta xatolik o'zi ishonchsizlik belgisi.
   */
  const accuracy = Math.min(Math.max(input.reported.accuracyMeters ?? 0, 0), 200);
  const allowed = radiusMeters + accuracy;

  if (distance > allowed) {
    return { ok: false, reason: "too_far", distanceMeters: distance };
  }

  return { ok: true, verified: true, distanceMeters: distance, reason: "within_radius" };
}
