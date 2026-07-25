import type { Metadata } from "next";
import { PublicIntake } from "@/components/intake/public-intake";

// Public secure-link form. Never indexed; no admin chrome (outside the (admin) group).
export const metadata: Metadata = {
  title: "Anketa — Liderlar.uz",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function PublicIntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="min-h-screen bg-surface">
      <PublicIntake token={token} />
    </main>
  );
}
