import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Kirish" };

export default async function LoginPage(props: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await props.searchParams;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy-deep p-4">
      {/* Brand glow decorations */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-electric/20 blur-[140px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-cyan/20 blur-[140px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[15%] top-[18%] h-40 w-40 rounded-full bg-lavender/15 blur-[80px]"
      />

      <div className="rise-in relative w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan to-electric font-display text-2xl font-bold text-white shadow-[0_10px_35px_rgba(0,199,232,0.45)]">
            L
          </span>
          <h1 className="font-display text-2xl font-semibold uppercase tracking-[0.14em] text-white">
            Liderlar.uz
          </h1>
          <p className="mt-1 text-xs font-bold uppercase tracking-[0.24em] text-cyan-light/70">
            Boshqaruv paneli
          </p>
        </div>

        <div className="rounded-panel border border-white/10 bg-white/[0.06] p-7 shadow-pop backdrop-blur-xl">
          {reason === "no-access" && (
            <p className="mb-4 rounded-[14px] border border-peach/40 bg-peach/10 px-3.5 py-2.5 text-xs font-semibold text-peach">
              Sessiya tugagan yoki akkauntingizga admin huquqi berilmagan.
            </p>
          )}
          <Suspense>
            <LoginForm next={next} />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-[11px] text-white/40">
          Faqat taklif qilingan adminlar uchun · liderlar.uz
        </p>
      </div>
    </main>
  );
}
