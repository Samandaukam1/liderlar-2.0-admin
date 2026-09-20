import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateCertificatePdf } from "@/lib/certificates/generate";
import { normalizeCertificateCode, CERTIFICATE_ROLE_LABEL } from "@/lib/mehr/certificate-code";
import { getSiteUrl } from "@/lib/site-url";
import { getMehrFlags } from "@/lib/mehr/flags";

// Shrift/QR/SVG rasterlash haqiqiy Node API'larini talab qiladi.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> };

/**
 * GET /api/mehr-cert/[code] — MEHR sertifikati PDF'i.
 *
 * HAMMASI SERVERDA ANIQLANADI (§14).
 *
 * Brauzerdan keladigan YAGONA narsa — sertifikat kodi. Ism,
 * rol, tadbir va ball kodga qarab BAZADAN o'qiladi. Ularni
 * parametr sifatida qabul qilsak, istalgan odam o'ziga
 * "Tashkilotchi" sertifikati chizdirib olardi.
 *
 * QR esa ommaviy tekshirish sahifasiga olib boradi — ya'ni
 * qog'ozdagi sertifikat ham har doim jonli holatga ishora
 * qiladi va bekor qilinganini yashira olmaydi.
 */
export async function GET(_request: Request, context: RouteContext) {
  const flags = await getMehrFlags();
  if (!flags.certificatesEnabled) {
    return NextResponse.json(
      { ok: false, code: "DISABLED", error: "Sertifikatlar hozircha yopiq." },
      { status: 503 },
    );
  }

  const { code: rawCode } = await context.params;
  const code = normalizeCertificateCode(decodeURIComponent(rawCode));

  if (!code) {
    return NextResponse.json(
      { ok: false, code: "INVALID_CODE", error: "Sertifikat kodi noto'g'ri." },
      { status: 400 },
    );
  }

  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("certificates")
    .select("code, role, status, issued_at, profiles(full_name), mehr_activities(title)")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    console.error("MEHR_CERT_LOOKUP_FAILED", { code: error.code, message: error.message });
    return NextResponse.json(
      { ok: false, code: "LOOKUP_FAILED", error: "Sertifikatni tekshirib bo'lmadi." },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", error: "Sertifikat topilmadi." },
      { status: 404 },
    );
  }

  const row = data as unknown as {
    code: string;
    role: string | null;
    status: string;
    issued_at: string;
    profiles: { full_name?: string } | null;
    mehr_activities: { title?: string } | null;
  };

  /*
   * BEKOR QILINGAN SERTIFIKAT CHIZILMAYDI.
   *
   * Uni PDF sifatida berish "haqiqiy nusxa" taassurotini
   * qoldirardi — holbuki u endi amalda emas. Tekshirish
   * sahifasi esa uni ochiq "bekor qilingan" deb ko'rsatadi.
   */
  if (row.status === "revoked") {
    return NextResponse.json(
      {
        ok: false,
        code: "REVOKED",
        error: "Bu sertifikat bekor qilingan.",
        verifyUrl: `${getSiteUrl()}/mehr365/sertifikat/${row.code}`,
      },
      { status: 410 },
    );
  }

  const fullName = row.profiles?.full_name?.trim();
  if (!fullName) {
    return NextResponse.json(
      { ok: false, code: "MISSING_NAME", error: "Sertifikat egasining ismi topilmadi." },
      { status: 422 },
    );
  }

  const roleLabel = row.role
    ? (CERTIFICATE_ROLE_LABEL[row.role as keyof typeof CERTIFICATE_ROLE_LABEL] ?? "Ishtirokchi")
    : "Ishtirokchi";

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateCertificatePdf({
      fullName,
      // QR jonli tekshiruvga olib boradi, PDF'ning o'ziga emas.
      targetUrl: `${getSiteUrl()}/mehr365/sertifikat/${row.code}`,
      metadata: {
        title: `MEHR 365+ sertifikati — ${fullName}`,
        author: "Liderlar",
        subject: `${roleLabel} · ${row.mehr_activities?.title ?? "Ezgulik ishi"}`,
        creator: "Liderlar MEHR 365+",
      },
    });
  } catch (err) {
    console.error("MEHR_CERT_RENDER_FAILED", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, code: "RENDER_FAILED", error: "Sertifikatni chizib bo'lmadi." },
      { status: 500 },
    );
  }

  return new NextResponse(pdfBytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${row.code}.pdf"`,
      /*
       * Keshlanmaydi: sertifikat har qanday paytda bekor
       * qilinishi mumkin va keshdagi nusxa buni bilmasdi.
       */
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
