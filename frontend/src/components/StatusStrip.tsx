import { useStore } from "../store";
import { Spinner } from "./primitives";

export function StatusStrip() {
  const s = useStore((st) => st.stream);

  let body: React.ReactNode = null;
  let tone = "text-slate-500 dark:text-slate-400";

  switch (s.status) {
    case "idle":
      body = "Ready.";
      break;
    case "provisioning":
      body = (
        <>
          <Spinner /> Provisioning throwaway database… (first run can take 10–40s)
        </>
      );
      break;
    case "generating":
      body = (
        <>
          <Spinner /> Generating…
        </>
      );
      break;
    case "validating":
      body = (
        <>
          <Spinner /> Validating (iteration {s.currentIteration})…
        </>
      );
      break;
    case "fixing":
      body = (
        <>
          <Spinner /> Fixing after iteration {s.currentIteration - 1}…
        </>
      );
      break;
    case "done":
      if (s.validationPassed) {
        tone = "text-emerald-600 dark:text-emerald-400 font-medium";
        body = `✓ success · ${s.iterationsUsed ?? s.currentIteration} iteration(s) · ${(s.durationSeconds ?? 0).toFixed(2)}s`;
      } else {
        tone = "text-rose-600 dark:text-rose-400 font-medium";
        body = `✗ ${"max_iterations_reached"} · ${s.iterationsUsed ?? s.currentIteration} iteration(s) · ${(s.durationSeconds ?? 0).toFixed(2)}s`;
      }
      break;
    case "error":
      tone = "text-rose-600 dark:text-rose-400 font-medium";
      body = `Error: ${s.errorMessage ?? "translation failed"}`;
      break;
  }

  return (
    <div
      className={
        "flex items-center gap-2 border-t border-slate-200 px-3 py-2 text-sm dark:border-slate-700 " + tone
      }
    >
      {body}
    </div>
  );
}
