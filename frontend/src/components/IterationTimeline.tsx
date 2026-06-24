import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { RUNNING_STATUSES, useStore } from "../store";
import type { IterationChip } from "../store";
import { Chip, Spinner } from "./primitives";

const PHASE_LABEL: Record<string, string> = {
  provisioning: "provisioning",
  generating: "generating",
  validating: "validating",
  fixing: "fixing",
};

function pill(chip: IterationChip) {
  if (chip.kind === "validated") {
    return chip.passed ? (
      <Chip tone="green">#{chip.iteration} ✓</Chip>
    ) : (
      <Chip tone="red">
        #{chip.iteration} ✗ {chip.errorCount} error(s)
      </Chip>
    );
  }
  if (chip.kind === "fix") return <Chip tone="amber">fix</Chip>;
  return <Chip tone="red">max reached</Chip>;
}

// Renders the agentic generate→validate→fix loop as a live horizontal stepper from
// the per-iteration history the store accumulates (`stream.chips`). Hidden until a
// run produces activity; shows an honest "escalating" pill while the loop stalls.
export function IterationTimeline() {
  const chips = useStore((s) => s.stream.chips);
  const status = useStore((s) => s.stream.status);
  const currentIteration = useStore((s) => s.stream.currentIteration);
  const stalled = useStore((s) => s.stream.stalled);

  const running = RUNNING_STATUSES.has(status);
  if (!running && chips.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-t border-slate-200 px-3 py-2 dark:border-slate-700">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">Loop</span>
      {chips.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />}
          <span className="shrink-0">{pill(c)}</span>
        </Fragment>
      ))}
      {running && (
        <>
          {chips.length > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />}
          <span className="shrink-0">
            {stalled ? (
              <Chip tone="amber">
                <Spinner /> escalating (hotter retry)
              </Chip>
            ) : (
              <Chip tone="indigo">
                <Spinner /> {PHASE_LABEL[status] ?? "working"}
                {currentIteration > 0 ? ` #${currentIteration}` : ""}
              </Chip>
            )}
          </span>
        </>
      )}
    </div>
  );
}
