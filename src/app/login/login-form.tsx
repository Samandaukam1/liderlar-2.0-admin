"use client";

import { useActionState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useState } from "react";
import { signInAction, type LoginState } from "@/lib/actions/auth";

const initialState: LoginState = { error: null };

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div>
        <label
          htmlFor="email"
          className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-cyan-light/80"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="admin@liderlar.uz"
          className="h-11 w-full rounded-[14px] border border-white/15 bg-white/[0.07] px-3.5 text-sm text-white placeholder:text-white/30 transition focus:border-cyan/60 focus:outline-2 focus:outline-cyan/30"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-cyan-light/80"
        >
          Parol
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className="h-11 w-full rounded-[14px] border border-white/15 bg-white/[0.07] px-3.5 pr-11 text-sm text-white placeholder:text-white/30 transition focus:border-cyan/60 focus:outline-2 focus:outline-cyan/30"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Parolni yashirish" : "Parolni ko‘rsatish"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/40 transition hover:text-cyan-light"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-[14px] border border-coral/40 bg-coral/10 px-3.5 py-2.5 text-xs font-semibold text-coral"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-gradient-to-r from-brand to-electric text-sm font-bold text-white shadow-[0_10px_30px_rgba(22,119,255,0.4)] transition hover:brightness-110 disabled:opacity-60"
      >
        <LogIn className="h-4 w-4" />
        {pending ? "Tekshirilmoqda…" : "Kirish"}
      </button>

      <p className="text-center text-[11px] leading-relaxed text-white/35">
        Ikki bosqichli tasdiqlash (MFA) tashkilot sozlamalarida yoqilgan bo‘lsa,
        kirishdan so‘ng qo‘shimcha kod so‘raladi.
      </p>
    </form>
  );
}
