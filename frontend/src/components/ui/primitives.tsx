// Store-free, presentational design-system primitives shared across the app:
// Button, IconButton, form controls (Field / TextInput / NumberValueInput / Select /
// Slider), Chip, PaneHeader, FooterBar, StatusText, Section, Spinner, and the cls()
// className helper. Nothing here reads the store.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, X, XCircle } from "lucide-react";
import * as RSelect from "@radix-ui/react-select";

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  children,
  variant = "default",
  className,
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "default" | "ghost" | "danger";
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";
  const variants: Record<string, string> = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500",
    default:
      "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
    ghost: "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
  };
  return (
    <button className={cls(base, variants[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function IconButton({
  children,
  className,
  ...props
}: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cls(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-tight text-slate-400 dark:text-slate-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  "h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputCls} {...props} />;
}

// Number field with a [ field ] [−|+] stepper (the native spinner is hidden).
// The field may be cleared while editing (emits null); on blur an empty field
// autofills 0 so it is never left blank. With `double`, the buttons double/halve
// the value (1024 → 2048 → 4096 …) instead of stepping by `step`.
export function NumberValueInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  double = false,
  ...props
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  double?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max" | "step">) {
  const current = value ?? 0;
  const clamp = (n: number) => (min != null && n < min ? min : max != null && n > max ? max : n);
  const bump = (dir: 1 | -1) => {
    const next = double
      ? dir === 1
        ? current > 0
          ? current * 2
          : (min ?? 1)
        : Math.floor(current / 2)
      : current + dir * step;
    onChange(clamp(next));
  };
  const stepBtn =
    "flex w-8 items-center justify-center bg-white text-lg leading-none text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700";
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <input
          type="number"
          className={cls(inputCls, "no-spinner")}
          {...props}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          onBlur={(e) => {
            if (e.target.value === "") onChange(0);
          }}
        />
      </div>
      <div className="flex h-9 shrink-0 overflow-hidden rounded-md border border-slate-300 dark:border-slate-600">
        <button
          type="button"
          aria-label="Decrease"
          className={cls(stepBtn, "border-r border-slate-300 dark:border-slate-600")}
          disabled={min != null && current <= min}
          onClick={() => bump(-1)}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Increase"
          className={stepBtn}
          disabled={max != null && current >= max}
          onClick={() => bump(1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

// Radix-based select so the option list always drops down *below* the trigger
// (rendered in a portal, so the sidebar's scroll never clips it). Option values
// must be non-empty (a Radix constraint). Use a sentinel for an "empty" choice.
export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <RSelect.Root value={value} onValueChange={onChange}>
      <RSelect.Trigger
        aria-label={placeholder}
        className={cls(inputCls, "flex cursor-pointer items-center justify-between gap-2", className)}
      >
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          side="bottom"
          sideOffset={4}
          className="z-50 max-h-60 min-w-[var(--radix-select-trigger-width)] overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
        >
          <RSelect.Viewport>
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-center rounded px-2 py-1.5 pr-7 text-sm text-slate-700 outline-none data-[highlighted]:bg-indigo-100 data-[highlighted]:text-indigo-900 dark:text-slate-200 dark:data-[highlighted]:bg-indigo-900/40 dark:data-[highlighted]:text-indigo-100"
              >
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className="absolute right-2">
                  <Check className="h-3.5 w-3.5" />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600 dark:bg-slate-700"
      />
      <span className="w-9 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">{value}</span>
    </div>
  );
}

export function Chip({
  children,
  tone = "default",
  size = "sm",
  title,
}: {
  children: ReactNode;
  tone?: "default" | "green" | "red" | "amber" | "indigo";
  size?: "sm" | "md";
  title?: string;
}) {
  const tones: Record<string, string> = {
    default: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    red: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  };
  // `sm` = compact pill (FeatureChips); `md` = h-7 so it aligns with the toolbar's IconButton.
  const sizes: Record<string, string> = {
    sm: "px-2 py-0.5 text-[11px]",
    md: "h-7 px-2.5 text-xs",
  };
  return (
    <span
      title={title}
      className={cls("inline-flex items-center gap-1 rounded-full font-medium", sizes[size], tones[tone])}
    >
      {children}
    </span>
  );
}

// Fixed-height (h-9) header for an editor pane. The fixed height (not padding)
// is what keeps two side-by-side panes aligned whether or not they carry an
// action in the right-hand `children` slot. The optional `center` slot is absolutely
// centered in the bar (independent of the title/actions widths).
export function PaneHeader({
  title,
  center,
  children,
}: {
  title: ReactNode;
  center?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex h-9 shrink-0 items-center justify-between gap-1 border-b border-slate-200 px-3 dark:border-slate-700">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</span>
      {center && <div className="absolute left-1/2 -translate-x-1/2">{center}</div>}
      {children}
    </div>
  );
}

// A connected pill segmented control (e.g. YAML | Graph, Refined | Original). The
// track holds the segments; the active segment is a raised white "thumb". This reads
// as a single switch, distinct from the standalone action buttons beside it.
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cls(
              "rounded px-2.5 py-0.5 text-[11px] font-medium normal-case transition-colors",
              active
                ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-300"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// A labelled on/off switch (a pill track with a sliding thumb): indigo when on, slate
// when off. Distinct from SegmentedControl (a one-of switch) - this is a single boolean.
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className={cls(
        // h-8 matches the adjacent Button box so the row's items-center truly centers it.
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
        checked ? "text-indigo-600 dark:text-indigo-300" : "text-slate-500 dark:text-slate-400",
      )}
    >
      <span
        className={cls(
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-600",
        )}
      >
        <span
          className={cls(
            "inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
      {label && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}

// Underline tab with an optional leading status dot. Put `items-stretch` on the
// parent bar so the 2px active underline overlaps the bar's own border-b.
export function Tab({
  active,
  onClick,
  dot,
  children,
}: {
  active: boolean;
  onClick: () => void;
  dot?: string;
  children: ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cls(
        "inline-flex items-center gap-1.5 border-b-2 px-3 text-xs font-semibold uppercase tracking-wide transition-colors",
        active
          ? "border-indigo-500 text-indigo-600 dark:border-indigo-400 dark:text-indigo-300"
          : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
      )}
    >
      {dot && <span className={cls("h-2 w-2 rounded-full", dot)} />}
      {children}
    </button>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-200 dark:border-slate-700">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        {title}
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        )}
      </button>
      {open && <div className="space-y-3 px-3 pb-4">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cls(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

// The shared h-9 footer bar at the bottom of every workbench pane, single source
// of truth so the mapping / SQL / result footers can't drift apart again.
export function FooterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-t border-slate-200 px-3 text-xs dark:border-slate-700 [&>*]:shrink-0">
      {children}
    </div>
  );
}

// One status vocabulary for the footers: a lucide icon (or spinner) + colored
// text. `success`→Check/emerald, `error`→X/rose, `warn`→AlertTriangle/amber,
// `running`→Spinner/slate, `muted`→no icon/slate.
type StatusTone = "success" | "error" | "warn" | "muted" | "running";

export function StatusText({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const color =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "error"
        ? "text-rose-600 dark:text-rose-400"
        : tone === "warn"
          ? "text-amber-600 dark:text-amber-400"
          : tone === "running"
            ? "text-slate-500 dark:text-slate-400"
            : "text-slate-400";
  return (
    <span className={cls("inline-flex items-center gap-1.5 text-xs font-medium", color)}>
      {tone === "success" && <Check className="h-3.5 w-3.5" />}
      {tone === "error" && <X className="h-3.5 w-3.5" />}
      {tone === "warn" && <AlertTriangle className="h-3.5 w-3.5" />}
      {tone === "running" && <Spinner />}
      {children}
    </span>
  );
}

// A single colored alert strip (icon + one line per message + optional muted note),
// used uniformly for every error/warning banner in the app, the SQL pre-flight
// banner, the schema-mapping validation errors, and the result-panel outcomes.
type IssueTone = "error" | "warning";

const ISSUE_TONES: Record<IssueTone, { wrap: string; note: string }> = {
  error: {
    wrap: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300",
    note: "text-rose-500 dark:text-rose-400",
  },
  warning: {
    wrap: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300",
    note: "text-amber-600 dark:text-amber-400",
  },
};

export function IssueStrip({ tone, lines, note }: { tone: IssueTone; lines: string[]; note?: string }) {
  const t = ISSUE_TONES[tone];
  const Icon = tone === "error" ? XCircle : AlertTriangle;
  return (
    <div
      className={cls(
        "flex max-h-28 shrink-0 items-start gap-1.5 overflow-y-auto border-t px-3 py-1.5 text-[11px]",
        t.wrap,
      )}
    >
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {note && <div className={t.note}>{note}</div>}
      </div>
    </div>
  );
}
