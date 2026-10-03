import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { loadPendingEdits } from "@/lib/profile-editor/review-service";
import { loadPendingEntries } from "@/lib/profile-editor/entry-review-service";
import { loadPendingCertificates } from "@/lib/profile-editor/certificate-review-service";
import { EditReviewList } from "./edit-review-list";
import { EntryReviewList } from "./entry-review-list";
import { CertificateReviewList } from "./certificate-review-list";

export const metadata = { title: "Profil tahrirlari" };
export const dynamic = "force-dynamic";

/**
 * FOYDALANUVCHI YUBORGAN PROFIL O'ZGARISHLARI.
 *
 * Bu navbatga FAQAT ko'rik talab qiladigan maydonlar tushadi:
 * tug'ilgan sana, hudud, yo'nalish. Qisqa ma'lumot va aloqa
 * ma'lumoti darhol nashr bo'ladi va bu yerda KO'RINMAYDI — ularda
 * tekshirib bo'ladigan da'vo yo'q.
 *
 * Shuning uchun navbatning bo'shligi "hech kim profilini
 * tahrirlamayapti" degani EMAS.
 */
export default async function ProfileEditsPage() {
  const ctx = await requirePermission("candidates.view");
  const canReview = hasPermission(ctx.roles, "candidates.edit");

  // Ikki navbat bir-biriga bog'liq emas — parallel yuklanadi.
  const [rows, entryRows, certificateRows] = await Promise.all([
    loadPendingEdits(),
    loadPendingEntries(),
    loadPendingCertificates(),
  ]);

  return (
    <div>
      <PageHeader
        title="Profil tahrirlari"
        description="Foydalanuvchilar yuborgan va tasdiq kutayotgan o‘zgarishlar"
        breadcrumbs={[{ label: "Profil tahrirlari" }]}
      />

      <p className="mb-4 rounded-card border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-soft">
        Bu navbatga <b>faqat tekshiruv talab qiladigan</b> maydonlar tushadi:
        tug‘ilgan sana, hudud va yo‘nalish. Qisqa ma‘lumot hamda aloqa
        ma‘lumotlari darhol profilga joylanadi va bu yerda ko‘rinmaydi.
        {!canReview && " Tasdiqlash uchun nomzodni tahrirlash ruxsati kerak."}
      </p>

      <p className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <span className="rounded-full bg-surface px-2.5 py-1 font-bold text-ink">
          Maydon o‘zgarishlari: {rows.length}
        </span>
        <span className="rounded-full bg-surface px-2.5 py-1 font-bold text-ink">
          Yangi yozuvlar: {entryRows.length}
        </span>
        <span className="rounded-full bg-surface px-2.5 py-1 font-bold text-ink">
          Sertifikatlar: {certificateRows.length}
        </span>
      </p>

      <h2 className="mb-2 text-sm font-bold text-ink">Maydon o‘zgarishlari</h2>
      <EditReviewList rows={rows} canReview={canReview} />

      {/*
        IKKI NAVBAT ALOHIDA KO'RSATILADI.

        Birinchisi mavjud maydonning qiymati o'zgarishi (eski -> yangi),
        ikkinchisi butunlay YANGI yozuv. Ularni aralashtirib ko'rsatish
        adminni "nima bilan ish qilayotganini" chalkashtirardi: birida
        solishtirish kerak, ikkinchisida mazmunni o'qish.
      */}
      <h2 className="mb-2 mt-6 text-sm font-bold text-ink">
        Yangi yozuvlar — ta‘lim, ish tajribasi, yutuqlar
      </h2>
      <EntryReviewList rows={entryRows} canReview={canReview} />

      {/*
        SERTIFIKATLAR UCHINCHI NAVBAT.

        Ularda qaror IKKILIK EMAS: tasdiqlash, "foydalanuvchi kiritgan"
        sifatida ochish yoki qaytarish. Shuning uchun boshqa ro'yxat —
        oldingi ikkisining tugmalari bu qarorni ifodalay olmaydi.
      */}
      <h2 className="mb-2 mt-6 text-sm font-bold text-ink">Sertifikatlar</h2>
      <CertificateReviewList rows={certificateRows} canReview={canReview} />
    </div>
  );
}
