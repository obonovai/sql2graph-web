import { Play, Square } from "lucide-react";
import { RUNNING_STATUSES, useStore } from "@/hooks/useStore";
import { Button, Select } from "@/components/ui/primitives";

// The primary run controls: pick the target language and translate. Validation
// mode + iteration budget live in the Settings sidebar (one home, no duplicate).
export function RunSetupBar() {
  const target = useStore((s) => s.form.target);
  const setTarget = useStore((s) => s.setTarget);
  const sql = useStore((s) => s.form.sql);
  const validity = useStore((s) => s.mappingValidity);
  const unmappedTables = useStore((s) => s.coverageUnmapped);
  const unmappedColumns = useStore((s) => s.coverageUnmappedColumns);
  const status = useStore((s) => s.stream.status);
  const translate = useStore((s) => s.translate);
  const stop = useStore((s) => s.stop);
  const clearWorkspace = useStore((s) => s.clearWorkspace);

  const running = RUNNING_STATUSES.has(status);
  // Mirror useStore.canTranslate(): gate on a valid mapping and SQL that won't be
  // rejected (unmapped tables/columns). The specifics show in the SQL window.
  const canTranslate =
    !running && !!sql.trim() && !!validity?.valid && unmappedTables.length === 0 && unmappedColumns.length === 0;
  const hint = !sql.trim()
    ? "Enter a SQL query to translate"
    : !validity?.valid
      ? "Provide a valid schema mapping first"
      : unmappedTables.length > 0
        ? "SQL references tables not in the mapping"
        : unmappedColumns.length > 0
          ? "SQL references columns not in the mapping"
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
