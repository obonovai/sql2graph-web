import type { ReactNode } from "react";
import { IconButton, cls } from "./primitives";

export function CollapsibleSidebar({
  side,
  open,
  onToggle,
  title,
  rail,
  children,
  width = 340,
}: {
  side: "left" | "right";
  open: boolean;
  onToggle: (open: boolean) => void;
  title: string;
  rail?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  const border = side === "left" ? "border-r" : "border-l";
  const expandGlyph = side === "left" ? "»" : "«";
  const collapseGlyph = side === "left" ? "«" : "»";

  if (!open) {
    return (
      <aside
        className={cls(
          "flex w-10 shrink-0 flex-col items-center gap-3 bg-slate-50 py-2 dark:bg-slate-900",
          border,
          "border-slate-200 dark:border-slate-700",
        )}
      >
        <IconButton onClick={() => onToggle(true)} title={`Show ${title}`}>
          {expandGlyph}
        </IconButton>
        <span className="select-none text-[11px] font-semibold uppercase tracking-wider text-slate-400 [writing-mode:vertical-rl]">
          {title}
        </span>
        {rail}
      </aside>
    );
  }

  return (
    <aside
      style={{ width }}
      className={cls(
        "flex shrink-0 flex-col bg-slate-50 dark:bg-slate-900",
        border,
        "border-slate-200 dark:border-slate-700",
      )}
    >
      <div
        className={cls(
          "flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700",
          side === "right" ? "flex-row" : "flex-row-reverse",
        )}
      >
        <IconButton onClick={() => onToggle(false)} title={`Hide ${title}`}>
          {collapseGlyph}
        </IconButton>
        <span className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
