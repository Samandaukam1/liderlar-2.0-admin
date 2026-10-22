/**
 * TASHQI ULANISHLAR — HAPPY EYEBALLS URINISH CHEGARASI.
 *
 * NEGA KERAK: Node 20+ ulanishda DNS bergan manzillarni (IPv4, IPv6)
 * navbat bilan sinaydi va birinchisiga atigi 250 ms beradi, keyin
 * uni uzib keyingisiga o'tadi. Vercel sin1'da api.telegram.org uchun
 * DNS ikkala manzilni qaytaradi, IPv6'ga esa yo'l yo'q (EHOSTUNREACH).
 * Singapur → Telegram (Yevropa) yo'li uzun: kechikish sal oshsa yoki
 * bitta SYN paketi yo'qolsa, IPv4 urinishi 250 ms da uziladi, IPv6
 * darhol yiqiladi va `fetch failed` (AggregateError ETIMEDOUT) chiqadi.
 *
 * 2026-10-22, 15:00 UTC soatida post botiga kelgan updatelarning 31% i
 * shu bilan javobsiz qoldi. fetchTelegram'ning 3 urinishi yordam
 * bermadi — har urinish yana o'sha 250 ms bilan cheklangan edi
 * (3 urinish + 1,2 s kutish jami ~2 s da tugardi).
 *
 * 2 s — RTT va bitta yo'qolgan SYN'ning qayta yuborilishiga (Linux'da
 * 1 s) yetadi. Sog'lom ulanish bundan sekinlashmaydi: chegara faqat
 * birinchi manzil javob bermay turganda kutiladi.
 */
import net from "node:net";

export const CONNECT_ATTEMPT_TIMEOUT_MS = 2_000;

net.setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
