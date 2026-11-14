import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(27,32,41,0.04)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
      <div>
        {eyebrow ? (
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-brand">{eyebrow}</div>
        ) : null}
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      {right}
    </div>
  );
}

type BadgeTone = "brand" | "caution" | "risk" | "neutral";

const badgeTones: Record<BadgeTone, string> = {
  brand: "bg-brand/10 text-brandink",
  caution: "bg-caution/10 text-cautionink",
  risk: "bg-risk/10 text-riskink",
  neutral: "bg-canvas2 text-inksoft",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): BadgeTone {
  if (status === "Completed" || status === "Reviewed" || status === "Success" || status === "Active")
    return "brand";
  if (status === "Review Required" || status === "Failed" || status === "Inactive") return "risk";
  return "caution";
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  const styles = {
    primary: "bg-brand text-surface ring-1 ring-brand/60 hover:bg-brandink",
    secondary: "border border-line bg-surface text-ink hover:bg-canvas2",
    ghost: "text-inksoft hover:text-ink hover:bg-canvas2",
    danger: "bg-risk text-surface hover:bg-riskink",
  }[variant];
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        styles,
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-inksoft">{label}</span>
      <div className="mt-1.5">{children}</div>
      {error ? <span className="mt-1 block text-xs font-medium text-riskink">{error}</span> : null}
      {!error && hint ? <span className="mt-1 block text-xs text-mute">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-mute focus:border-brand focus:ring-2 focus:ring-brand/20",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-mute focus:border-brand focus:ring-2 focus:ring-brand/20",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20",
        className,
      )}
      {...props}
    />
  );
}

export function ProgressBar({ value, tone = "brand" }: { value: number; tone?: "brand" | "mute" | "caution" | "risk" }) {
  const color = { brand: "bg-brand", mute: "bg-mute", caution: "bg-caution", risk: "bg-risk" }[tone];
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-line">
      <div
        className={cn("h-full rounded-full transition-all duration-700", color)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "mute" }: { label: string; value: ReactNode; hint?: string; tone?: "mute" | "brand" | "caution" }) {
  const hintColor = { mute: "text-mute", brand: "text-brandink", caution: "text-cautionink" }[tone];
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-mute">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
      {hint ? <div className={cn("mt-1 text-xs", hintColor)}>{hint}</div> : null}
    </Card>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-sm text-mute hover:text-ink">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-line bg-canvas2 px-4 py-10 text-center">
      <div className="text-sm font-medium">{title}</div>
      {hint ? <div className="mt-1 text-xs text-mute">{hint}</div> : null}
    </div>
  );
}

export function ConfidenceRing({ value, size = 76 }: { value: number; size?: number }) {
  const angle = Math.round((value / 100) * 360);
  const tone = value >= 70 ? "var(--color-brand)" : "var(--color-caution)";
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${tone} ${angle}deg, var(--color-line) ${angle}deg)`,
      }}
    >
      <div
        className="grid place-items-center rounded-full bg-surface"
        style={{ width: size - 18, height: size - 18 }}
      >
        <div className="text-center">
          <div className="font-display text-lg font-semibold leading-none">{value}%</div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-mute">conf.</div>
        </div>
      </div>
    </div>
  );
}
