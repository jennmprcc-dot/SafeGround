/**
 * SafeGround UI kit — build-once, reuse-everywhere (DESIGN_SYSTEM §4).
 * Dependency-free (React + Tailwind only). Mobile-first; 48px+ touch targets.
 * No alarm styling anywhere: calm, warm, explicit.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "~/lib/cn";
import { useLanguage } from "~/lib/i18n";
import { CheckIcon, ClockIcon, InfoIcon, SearchIcon } from "~/lib/icons";

/* ── 4.1 Buttons ─────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "text" | "quiet" | "destructive";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  full?: boolean; // full-width on mobile forms
  disabledReason?: string; // explains WHY it's disabled (helper text)
}

const btnBase =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[12px] px-4 text-btn transition-colors duration-150 " +
  "disabled:opacity-40 disabled:cursor-not-allowed";

const btnVariants: Record<ButtonVariant, string> = {
  primary: "bg-sg-sage text-white hover:bg-sg-sage-deep active:bg-sg-sage-deep",
  secondary: "border-2 border-sg-ink bg-transparent text-sg-ink hover:bg-sg-sage-wash",
  text: "text-sg-sky underline underline-offset-2 hover:text-sg-sage-deep min-h-[48px] px-2",
  quiet: "text-sg-ink-soft hover:text-sg-ink hover:underline underline-offset-2 min-h-[48px] px-2",
  destructive: "text-sg-danger-gentle hover:underline underline-offset-2 min-h-[48px] px-2",
};

export function Button({ variant = "primary", full, disabledReason, className, children, ...rest }: ButtonProps) {
  const helperId = useId();
  const disabled = rest.disabled;
  return (
    <span className={cn("inline-flex flex-col", full && "w-full")}>
      <button
        type="button"
        className={cn(btnBase, btnVariants[variant], full && "w-full", className)}
        aria-describedby={disabled && disabledReason ? helperId : undefined}
        {...rest}
      >
        {children}
      </button>
      {disabled && disabledReason ? (
        <span id={helperId} className="mt-1.5 px-1 text-small text-sg-ink-soft">{disabledReason}</span>
      ) : null}
    </span>
  );
}

/** Mandatory location-once CTA pattern (DESIGN_SYSTEM §4.1 / PRD R-P3). */
export function LocationOnceButton({ onClick, caption, className }: { onClick?: () => void; caption?: string; className?: string }) {
  return (
    <div className={cn("inline-flex flex-col items-start", className)}>
      <Button variant="secondary" onClick={onClick}>
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
        Use my location once
      </Button>
      <span className="mt-1.5 px-1 text-small text-sg-ink-soft">
        {caption ?? "Only this lookup — nothing stored unless you share it."}
      </span>
    </div>
  );
}

/* ── 4.2 Cards ───────────────────────────────────────────────── */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("rounded-[16px] border border-sg-line bg-sg-card p-4 shadow-[0_1px_2px_rgba(30,42,50,0.08)]", className)}>
      {children}
    </section>
  );
}

/* ── 4.3 List rows ───────────────────────────────────────────── */

export function IconTile({ wash, children, className }: { wash: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] text-sg-ink", wash, className)} aria-hidden>
      {children}
    </span>
  );
}

export function ListRow({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) {
  const content = (
    <div className={cn("flex min-h-[72px] items-center gap-4 border-b border-sg-line px-1 py-3", onClick && "cursor-pointer", className)}>
      {children}
    </div>
  );
  if (onClick) {
    return (
      <li className="list-none">
        <button type="button" onClick={onClick} className="block w-full text-left">
          {content}
        </button>
      </li>
    );
  }
  return <li className="list-none">{content}</li>;
}

/* ── 4.7 Status badges ───────────────────────────────────────── */

export type BadgeKind = "Verified" | "Reported" | "Active" | "Planned" | "Resolved" | "Okay" | "Overdue";

const badgeStyles: Record<BadgeKind, string> = {
  Verified: "bg-sg-sage-wash text-sg-sage",
  Reported: "bg-sg-gold-wash text-[#6B5212]",
  Active: "bg-sg-clay-wash text-sg-clay",
  Planned: "bg-sg-gold-wash text-[#6B5212]",
  Resolved: "bg-sg-line text-sg-ink-soft",
  Okay: "bg-sg-sage-wash text-sg-sage",
  Overdue: "bg-sg-clay-wash text-sg-clay",
};

export function StatusBadge({ kind, children }: { kind: BadgeKind; children?: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-badge uppercase tracking-[0.04em]",
        badgeStyles[kind],
      )}
    >
      {children ?? kind}
    </span>
  );
}

/* ── 4.8 Toast ───────────────────────────────────────────────── */

export type ToastKind = "success" | "info" | "error";

const toastCopy: Record<ToastKind, string> = {
  success: "You're checked in — rest easy.",
  info: "Showing saved list.",
  error: "No connection right now — your draft is saved. Try again when you can.",
};

export function Toast({
  kind = "info",
  message,
  action,
  onAction,
  onDismiss,
}: {
  kind?: ToastKind;
  message?: string;
  action?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className="pointer-events-auto mx-4 mb-4 flex items-center justify-between gap-3 rounded-[12px] bg-sg-ink px-4 py-3 text-sg-card shadow-[0_8px_32px_rgba(30,42,50,0.18)]"
    >
      <p className="text-small leading-snug text-sg-card">{message ?? toastCopy[kind]}</p>
      <span className="flex shrink-0 items-center gap-3">
        {action ? (
          <button type="button" onClick={onAction} className="min-h-[44px] px-1 text-small font-semibold text-sg-sage-wash underline underline-offset-2">
            {action}
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" onClick={onDismiss} aria-label="Dismiss message" className="flex min-h-[44px] min-w-[44px] items-center justify-center text-sg-card">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** Toast provider: renders a stack above the bottom nav. Copy bank §4.8 — no names, no locations, no overdue status. */
export function ToastStack({ toasts, onDismiss }: { toasts: ToastState[]; onDismiss: (id: number) => void }) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-[72px] z-50 flex flex-col gap-2">
        {/* A11y: no aria-live here — each Toast already carries role="status"
         * (or "alert" for errors); a live container would double-announce. */}
        {toasts.map((t) => (
        <Toast key={t.id} kind={t.kind} message={t.message} action={t.action} onAction={t.onAction} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

export interface ToastState {
  id: number;
  kind: ToastKind;
  message?: string;
  action?: string;
  onAction?: () => void;
}

/** useToasts — auto-dismiss after 4s (per §4.8). */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const nextId = useRef(1);

  const push = (t: Omit<ToastState, "id">) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4000);
  };
  const dismiss = (id: number) => setToasts((prev) => prev.filter((x) => x.id !== id));

  return { toasts, push, dismiss };
}

/* ── 4.5 Dialog (center confirm) ─────────────────────────────── */

export function Dialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
  destructive,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  destructive?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-[rgba(30,42,50,0.6)]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        className="relative w-full max-w-[340px] rounded-[20px] bg-sg-card p-6 shadow-[0_8px_32px_rgba(30,42,50,0.18)] outline-none"
      >
        <h2 className="text-h2">{title}</h2>
        <div className="mt-2 text-body text-sg-ink-soft">{children}</div>
        <div className="mt-6 flex flex-col gap-2">
          <Button variant={destructive ? "destructive" : "primary"} full onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="quiet" full onClick={onClose}>
            Keep as is
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── 4.5 Bottom sheet (mobile default for details) ───────────── */

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  peek = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  peek?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-[rgba(30,42,50,0.6)]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        className={cn(
          "absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-[560px] flex-col rounded-t-[20px] bg-sg-card shadow-[0_8px_32px_rgba(30,42,50,0.18)] outline-none transition-[transform] duration-200 ease-out",
          peek ? "max-h-[45vh]" : "max-h-[90vh]",
        )}
      >
        {/* drag handle */}
        <div className="flex items-center justify-center pt-3 pb-1" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-sg-line" />
        </div>
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 className="text-h2">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex min-h-[48px] min-w-[48px] items-center justify-center text-sg-ink-soft">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),16px)]">{children}</div>
      </div>
    </div>
  );
}

/* ── 4.6 Form inputs ─────────────────────────────────────────── */

export function TextField({
  label,
  helper,
  error,
  ...rest
}: { label: string; helper?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-btn font-medium">
        {label}
      </label>
      <input
        id={id}
        className={cn(
          "min-h-[52px] w-full rounded-[12px] border-2 bg-sg-card px-4 text-body text-sg-ink outline-none transition-colors placeholder:text-sg-ink-soft/70",
          error ? "border-sg-danger-gentle" : "border-sg-line focus:border-sg-ink",
        )}
        {...rest}
      />
      {error ? <p className="text-small text-sg-danger-gentle">{error}</p> : helper ? <p className="text-small text-sg-ink-soft">{helper}</p> : null}
    </div>
  );
}

export function TextArea({
  label,
  helper,
  error,
  ...rest
}: { label: string; helper?: string; error?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-btn font-medium">
        {label}
      </label>
      <textarea
        id={id}
        className={cn(
          "min-h-[52px] w-full rounded-[12px] border-2 bg-sg-card px-4 py-3 text-body text-sg-ink outline-none transition-colors placeholder:text-sg-ink-soft/70",
          error ? "border-sg-danger-gentle" : "border-sg-line focus:border-sg-ink",
        )}
        {...rest}
      />
      {rest.maxLength ? (
        <p className="text-right text-small text-sg-ink-soft">
          {String(rest.value ?? "").length}/{rest.maxLength}
        </p>
      ) : null}
      {error ? <p className="text-small text-sg-danger-gentle">{error}</p> : helper ? <p className="text-small text-sg-ink-soft">{helper}</p> : null}
    </div>
  );
}

/** 2-column chip grid (icon + label, sage-wash when selected). */
export function ChipGrid<T extends string>({
  options,
  selected,
  onToggle,
  label,
}: {
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  selected: T[];
  onToggle: (value: T) => void;
  label: string;
}) {
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="sr-only">{label}</legend>
      {options.map((opt) => {
        const on = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(opt.value)}
            className={cn(
              "flex min-h-[52px] items-center gap-2 rounded-[12px] border-2 px-3 text-body transition-colors",
              on ? "border-sg-sage bg-sg-sage-wash text-sg-sage-deep" : "border-sg-line bg-sg-card text-sg-ink hover:bg-sg-paper",
            )}
          >
            {opt.icon}
            <span className="font-medium leading-tight">{opt.label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

export function SearchField({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sg-ink-soft" aria-hidden>
        <SearchIcon size={20} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onSubmit) {
            e.preventDefault();
            try {
              onSubmit();
            } catch {
              /* analytics submit must never break search */
            }
          }
        }}
        placeholder={placeholder ?? "Search name or place…"}
        aria-label="Search resources by name or place"
        className="min-h-[52px] w-full rounded-[12px] border-2 border-sg-line bg-sg-card pl-12 pr-4 text-body text-sg-ink outline-none transition-colors placeholder:text-sg-ink-soft/70 focus:border-sg-ink"
      />
    </div>
  );
}

/* ── Empty state: what this is → why it matters → one next step ─ */

export function EmptyState({
  title,
  body,
  steps,
  icon,
}: {
  title: string;
  body: string;
  steps?: ReactNode; // one or more next-step actions
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[16px] border border-sg-line bg-sg-card px-6 py-8 text-center">
      {icon ? <span className="text-sg-ink-soft" aria-hidden>{icon}</span> : null}
      <h3 className="text-h2">{title}</h3>
      <p className="max-w-xs text-body text-sg-ink-soft">{body}</p>
      {steps ? <div className="mt-3 flex flex-col gap-2">{steps}</div> : null}
    </div>
  );
}

/* ── Skeleton: 3 gray bars ────────────────────────────────────── */

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-[12px] border border-sg-line bg-sg-card p-3">
          <span className="h-12 w-12 shrink-0 animate-pulse rounded-[12px] bg-sg-line" />
          <div className="flex flex-1 flex-col gap-2">
            <span className="h-3.5 w-2/3 animate-pulse rounded-full bg-sg-line" />
            <span className="h-3 w-1/2 animate-pulse rounded-full bg-sg-line" />
            <span className="h-3 w-1/3 animate-pulse rounded-full bg-sg-line" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Consent receipt (shown EVERYWHERE sharing happens) ───────── */

export function ConsentReceipt({
  who,
  what,
  howLong,
  stopLabel = "Pause sharing",
  onStop,
  className,
}: {
  who: string;
  what: string;
  howLong: string;
  stopLabel?: string;
  onStop?: () => void;
  className?: string;
}) {
  // EN|ES (PR-B): the chrome labels translate; the who/what/howLong values
  // stay caller-provided (the peer-support + hometeam pages pass translated
  // copy in). EN fallback keeps this never-blank.
  const { t } = useLanguage();
  const chrome = { title: t("consent_title"), who: t("consent_who"), what: t("consent_what"), how: t("consent_howlong"), stop: t("consent_stop") };
  return (
    <div className={cn("rounded-[16px] border border-sg-line bg-sg-paper p-4", className)}>
      <p className="text-small font-semibold text-sg-ink">{chrome.title}</p>
      <dl className="mt-2 flex flex-col gap-1.5 text-small text-sg-ink-soft">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 font-medium text-sg-ink">{chrome.who}</dt>
          <dd>{who}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 font-medium text-sg-ink">{chrome.what}</dt>
          <dd>{what}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 font-medium text-sg-ink">{chrome.how}</dt>
          <dd>{howLong}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 font-medium text-sg-ink">{chrome.stop}</dt>
          <dd>
            {onStop ? (
              <button type="button" onClick={onStop} className="text-sg-sky underline underline-offset-2">
                {stopLabel}
              </button>
            ) : (
              stopLabel
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/* ── Offline banner: "No connection — showing saved list from X ago" ─ */

export function OfflineBanner({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="status" className="flex items-center justify-between gap-3 bg-sg-sky-wash px-4 py-2.5 text-small text-sg-sky">
      <span className="flex items-center gap-2">
        <InfoIcon size={16} aria-hidden />
        {message ?? "No connection — showing saved list."}
      </span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="min-h-[44px] shrink-0 px-1 font-semibold text-sg-sky underline underline-offset-2">
          Try again
        </button>
      ) : null}
    </div>
  );
}

/* ── Verified inline check ────────────────────────────────────── */

export function VerifiedMark({ label = "Verified" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-small font-medium text-sg-sage">
      <CheckIcon size={14} aria-hidden />
      {label}
    </span>
  );
}

/* ── "Updated X ago" / timestamps ─────────────────────────────── */

export function UpdatedLine({ minutesAgo }: { minutesAgo: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-small text-sg-ink-soft">
      <ClockIcon size={14} aria-hidden />
      Updated {minutesAgo < 60 ? `${Math.max(1, minutesAgo)} min ago` : `${Math.round(minutesAgo / 60)}h ago`}
    </span>
  );
}