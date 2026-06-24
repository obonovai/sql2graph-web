import { Play, Square } from "lucide-react";
import { RUNNING_STATUSES, useStore } from "../store";
import { Button, NumberValueInput, Select } from "./primitives";

// The "what will happen when I hit Translate" plan in one row: target language,
// validation mode, and iteration budget — gathered out of the toolbar/sidebar —
// alongside the primary Translate / Stop / Clear actions and an inline reason
// when Translate is unavailable.
export function RunSetupBar() {
  const target = useStore((s) => s.form.target);
  const setTarget = useStore((s) => s.setTarget);
  const mode = useStore((s) => s.form.validation.mode);
  const setValidationMode = useStore((s) => s.setValidationMode);
  const maxIterations = useStore((s) => s.form.validation.max_iterations);
  const setMaxIterations = useStore((s) => s.setMaxIterations);
  const sql = useStore((s) => s.form.sql);
  const validity = useStore((s) => s.mappingValidity);
  const status = useStore((s) => s.stream.status);
  const translate = useStore((s) => s.translate);
  const stop = useStore((s) => s.stop);
  const clearWorkspace = useStore((s) => s.clearWorkspace);

  const running = RUNNING_STATUSES.has(status);
  const canTranslate = !running && !!sql.trim() && !!validity?.valid;
  const hint = !sql.trim()
    ? "Enter a SQL query to translate"
    : !validity?.valid
      ? "Provide a valid schema mapping first"
      : "";

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Target</span>
        <Select
          value={target}
          onChange={(v) => setTarget(v as never)}
          className="!w-auto"
          options={[
            { value: "cypher", label: "Cypher" },
            { value: "aql", label: "AQL" },
            { value: "gremlin", label: "Gremlin" },
          ]}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Validation</span>
        <Select
          value={mode}
          onChange={(v) => setValidationMode(v as never)}
          className="!w-auto"
          options={[
            { value: "none", label: "none" },
            { value: "syntax", label: "syntax" },
            { value: "server", label: "server" },
          ]}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Max iterations</span>
        <div className="w-32">
          <NumberValueInput min={1} value={maxIterations} onChange={setMaxIterations} />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {hint && !running && <span className="text-[11px] text-amber-600 dark:text-amber-400">{hint}</span>}
        {running ? (
          <Button variant="danger" onClick={stop}>
            <Square className="h-4 w-4" /> Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void translate()} disabled={!canTranslate} title={hint || "Translate"}>
            <Play className="h-4 w-4" /> Translate
          </Button>
        )}
        <Button variant="default" onClick={clearWorkspace} disabled={running}>
          Clear
        </Button>
      </div>
    </div>
  );
}
