import { ChevronRight, Eraser, Play, Square } from "lucide-react";
import { RUNNING_STATUSES, useStore } from "@/hooks/useStore";
import { Button, Tab, Toggle } from "@/components/ui/primitives";

// The bar directly above the window: the two workspace-stage tabs (left, no dots -
// the per-mapping status dots live on the SQL window's inner document tabs) + the
// contextual actions (right). Build mapping -> Generate/Stop + Use this mapping +
// Clear; Translate -> Translate/Stop + Clear. The dialect/target selectors live in
// the left "Formats" sidebar section.
export function WorkspaceBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  return (
    <div className="flex h-11 shrink-0 flex-wrap items-stretch gap-3 border-b border-slate-200 bg-white pr-3 dark:border-slate-700 dark:bg-slate-900">
      {/* Stages read left-to-right: build a mapping, then translate with it. */}
      <div role="tablist" className="flex items-stretch">
        <Tab active={view === "mapping"} onClick={() => setView("mapping")}>
          Build mapping
        </Tab>
        <ChevronRight aria-hidden className="h-3.5 w-3.5 self-center text-slate-300 dark:text-slate-600" />
        <Tab active={view === "sql"} onClick={() => setView("sql")}>
          Translate SQL
        </Tab>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {view === "mapping" ? <MappingActions /> : <TranslateActions />}
      </div>
    </div>
  );
}

function MappingActions() {
  const ddl = useStore((s) => s.form.ddl);
  const refineWithLlm = useStore((s) => s.form.refineWithLlm);
  const setRefineWithLlm = useStore((s) => s.setRefineWithLlm);
  const status = useStore((s) => s.build.status);
  const buildMapping = useStore((s) => s.buildMapping);
  const stopBuild = useStore((s) => s.stopBuild);
  const clearMapping = useStore((s) => s.clearMapping);

  const loading = status === "loading";

  return (
    <>
      <Toggle
        checked={refineWithLlm}
        onChange={setRefineWithLlm}
        disabled={loading}
        title={
          refineWithLlm
            ? "AI polishes node/edge names after generating, and shows what it changed"
            : "Generate a deterministic mapping only (no AI, no model call)"
        }
        label="Refine with AI"
      />
      {loading ? (
        <Button variant="danger" onClick={stopBuild}>
          <Square className="h-4 w-4" /> Stop
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={() => void buildMapping()}
          disabled={!ddl.trim()}
          title={ddl.trim() ? "Generate a mapping from the DDL" : "Paste CREATE TABLE DDL first"}
        >
          <Play className="h-4 w-4" /> Generate
        </Button>
      )}
      <Button variant="default" onClick={clearMapping} disabled={loading} title="Clear the DDL and draft mapping">
        <Eraser className="h-4 w-4" /> Clear
      </Button>
    </>
  );
}

function TranslateActions() {
  const sql = useStore((s) => s.form.sql);
  const validity = useStore((s) => s.mappingValidity);
  const unmappedTables = useStore((s) => s.coverageUnmapped);
  const unmappedColumns = useStore((s) => s.coverageUnmappedColumns);
  const status = useStore((s) => s.stream.status);
  const translate = useStore((s) => s.translate);
  const stop = useStore((s) => s.stop);
  const clearWorkspace = useStore((s) => s.clearWorkspace);

  const running = RUNNING_STATUSES.has(status);
  // Mirror useStore.canTranslate(): gate on a valid ACTIVE mapping and SQL that won't
  // be rejected. The specifics show in the SQL window / on the inner tab dots.
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
    <>
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
      <Button variant="default" onClick={clearWorkspace} disabled={running} title="Clear the SQL query and result">
        <Eraser className="h-4 w-4" /> Clear
      </Button>
    </>
  );
}
