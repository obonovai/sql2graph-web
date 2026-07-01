// Build mode's right-hand pane: paste CREATE TABLE DDL, then Generate (in the run
// bar) turns it into a draft mapping. The generated mapping itself lands in the left
// Schema-mapping panel (via form.mappingYaml), so this pane only owns the DDL input,
// its table-count footer, and the coverage audit strip. Cmd/Ctrl+Enter in the editor
// also triggers Generate.
import { useRef } from "react";
import { Upload } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { Chip, FooterBar, IconButton, PaneHeader } from "@/components/ui/primitives";

const DDL_PLACEHOLDER = `CREATE TABLE person (
  id INT PRIMARY KEY,
  name VARCHAR(80),
  city_id INT REFERENCES city(id)
);`;

export function BuildMappingPanel() {
  const theme = useStore((s) => s.theme);
  const ddl = useStore((s) => s.form.ddl);
  const setDdl = useStore((s) => s.setDdl);
  const buildMapping = useStore((s) => s.buildMapping);
  const result = useStore((s) => s.build.result);
  const status = useStore((s) => s.build.status);
  const fileRef = useRef<HTMLInputElement>(null);

  // Live count of CREATE TABLE statements, for the footer chip.
  const tableCount = (ddl.match(/create\s+table\b/gi) ?? []).length;
  const report = result?.report;
  const auditLines = report
    ? [...report.dropped_objects.map((d) => `Dropped ${d.name}: ${d.reason}`), ...(result?.warnings ?? [])]
    : [];

  const onUploadDdl = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setDdl(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  return (
    <div className="flex h-full flex-col">
      <PaneHeader title="CREATE TABLE DDL">
        <IconButton onClick={() => fileRef.current?.click()} title="Upload .sql">
          <Upload className="h-4 w-4" />
        </IconButton>
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeEditor
          value={ddl}
          onChange={setDdl}
          language="sql"
          theme={theme}
          onSubmit={() => void buildMapping()}
          placeholder={DDL_PLACEHOLDER}
        />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".sql,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadDdl(f);
          e.target.value = "";
        }}
      />
      {/* Coverage audit: dropped objects + warnings from the generated draft. */}
      {auditLines.length > 0 && status === "done" && (
        <div className="shrink-0 border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          {auditLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      <FooterBar>
        {tableCount > 0 ? (
          <Chip tone="default">
            {tableCount} table{tableCount === 1 ? "" : "s"}
          </Chip>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500">No tables yet</span>
        )}
        {/* Junction tables collapsed to edges: the one coverage figure not already
            shown in the left mapping panel's node/edge footer. */}
        {status === "done" && report && report.edge_tables.length > 0 && (
          <Chip tone="green" title={report.edge_tables.join(", ")}>
            {report.edge_tables.length} junction{report.edge_tables.length === 1 ? "" : "s"} → edge
          </Chip>
        )}
      </FooterBar>
    </div>
  );
}
