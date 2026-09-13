"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { activateStyleProfileAction } from "@/lib/actions/sales";

/**
 * USLUB QORALAMASINI FAOLLASHTIRISH — ODAM QILADIGAN QADAM (22-band).
 *
 * Qayta hisoblash FAOL profilni ustidan yozardi va auditda ko'rilgan
 * "hi" li profil aynan shu yo'l bilan jonli botga tushgan edi. Endi
 * hisoblash qoralama yaratadi, faollashtirish esa alohida va ochiq
 * tasdiq talab qiladi.
 */
export function StyleActivator({
  profileId,
  humanMessageCount,
}: {
  profileId: string;
  humanMessageCount: number;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const activate = () => {
    // Bu jonli botning yozuv uslubini o'zgartiradi — tasdiqsiz emas.
    const ok = window.confirm(
      `Bu profil ${humanMessageCount} ta inson xabaridan hisoblangan.\n\n` +
        "Faollashtirilsa, bot MIJOZLARGA shu uslubda yoza boshlaydi. Davom etasizmi?",
    );
    if (!ok) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.set("profileId", profileId);
      const result = await activateStyleProfileAction(formData);
      if (result.ok) toast("success", "Faollashtirildi", result.message);
      else toast("error", "Xato", result.error);
    });
  };

  return (
    <Button type="button" variant="secondary" disabled={pending} onClick={activate}>
      Faollashtirish
    </Button>
  );
}
