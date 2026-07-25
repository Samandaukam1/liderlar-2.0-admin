import { cn } from "@/lib/utils";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/* ----------------------------- Button ----------------------------- */

type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "success"
  | "ai";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-brand to-electric text-white shadow-[0_8px_24px_rgba(22,119,255,0.28)] hover:brightness-110",
  secondary:
    "border border-line-strong bg-card text-ink hover:border-brand/50 hover:bg-surface",
  ghost: "text-ink-soft hover:bg-brand/8 hover:text-ink",
  danger:
    "bg-gradient-to-r from-coral to-rose text-white shadow-[0_8px_24px_rgba(255,133,133,0.3)] hover:brightness-105",
  success:
    "bg-gradient-to-r from-green to-mint text-white shadow-[0_8px_24px_rgba(100,199,123,0.3)] hover:brightness-105",
  ai: "ai-gradient text-white shadow-[0_8px_28px_rgba(105,82,224,0.35)] hover:brightness-110",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[14px] font-bold transition duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-base",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

/* ----------------------------- Fields ----------------------------- */

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-[14px] border border-line bg-card px-3.5 text-sm text-ink placeholder:text-ink-soft/60 transition focus:border-brand/60 focus:outline-2 focus:outline-offset-0 focus:outline-brand/25",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-[14px] border border-line bg-card px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-soft/60 transition focus:border-brand/60 focus:outline-2 focus:outline-offset-0 focus:outline-brand/25",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full appearance-none rounded-[14px] border border-line bg-card px-3.5 text-sm text-ink transition focus:border-brand/60 focus:outline-2 focus:outline-brand/25",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({
  children,
  htmlFor,
  className,
}: {
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft",
        className,
      )}
    >
      {children}
    </label>
  );
}

export function FormField({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="mt-1 text-xs font-semibold text-coral" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-soft">{hint}</p>
      ) : null}
    </div>
  );
}

/* ----------------------------- Card ----------------------------- */

export function Card({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-line bg-card p-6 shadow-card",
        interactive &&
          "transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover",
        className,
      )}
    >
      {children}
    </div>
  );
}
