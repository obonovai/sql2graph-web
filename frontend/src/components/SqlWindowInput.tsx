import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { MappingBody } from "@/components/MappingBody";
import { FeatureChips } from "@/components/FeatureChips";
import { SqlPreflightBanner } from "@/components/SqlPreflightBanner";
import { FooterBar, IconButton, IssueStrip, SegmentedControl, StatusText, Tab, cls } from "@/components/ui/primitives";

// The SQL window's left (input) pane. An inner tab strip switches between the ACTIVE
// schema mapping (so you can see/edit/replace what translation will use) and the SQL
// query. The inner tabs carry the green/red status dots; the top-level tabs do not.
// The right pane of the SQL window stays the OutcomePanel regardless of this tab.
export function SqlWindowInput() {
  const sqlInner = useStore((s) => s.sqlInner);
  const setSqlInner = useStore((s) => s.setSqlInner);
  const mappingYaml = useStore((s) => s.form.mappingYaml);
  const setMappingYaml = useStore((s) => s.setMappingYaml);
  const validity = useStore((s) => s.mappingValidity);
  const sql = useStore((s) => s.form.sql);
  const setSql = useStore((s) => s.setSql);
  const sqlParseOk = useStore((s) => s.sqlParseOk);
  const coverageUnmapped = useStore((s) => s.coverageUnmapped);
  const coverageUnmappedColumns = useStore((s) => s.coverageUnmappedColumns);
  const theme = useStore((s) => s.theme);
  const refreshValidity = useStore((s) => s.refreshMappingValidity);
  const refreshFeatures = useStore((s) => s.refreshFeatures);
  const translate = useStore((s) => s.translate);
  const yamlRef = useRef<HTMLInputElement>(null);
  const sqlRef = useRef<HTMLInputElement>(null);
  const [pane, setPane] = useState<"yaml" | "graph">("yaml");

  const mappingDot = validity == null ? "bg-slate-300" : validity.valid ? "bg-emerald-500" : "bg-rose-500";
  const sqlDot = !sql.trim()
    ? "bg-slate-300"
    : coverageUnmapped.length > 0 || coverageUnmappedColumns.length > 0
      ? "bg-rose-500"
      : !sqlParseOk
        ? "bg-amber-500"
        : "bg-emerald-500";

  const onUploadYaml = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setMappingYaml(String(reader.result ?? ""));
      void refreshValidity();
    };
    reader.readAsText(file);
  };
  const onUploadSql = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setSql(String(reader.result ?? ""));
      void refreshFeatures();
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-stretch border-b border-slate-200 dark:border-slate-700">
        <div role="tablist" className="flex items-stretch">
          <Tab active={sqlInner === "mapping"} dot={mappingDot} onClick={() => setSqlInner("mapping")}>
            Schema mapping
          </Tab>
          <Tab active={sqlInner === "sql"} dot={sqlDot} onClick={() => setSqlInner("sql")}>
            SQL
          </Tab>
        </div>
        <div className="ml-auto flex items-center gap-2 pr-2">
          {sqlInner === "mapping" ? (
            <>
              <IconButton onClick={() => yamlRef.current?.click()} title="Upload .yaml">
                <Upload className="h-4 w-4" />
              </IconButton>
              <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
              <SegmentedControl
                value={pane}
                onChange={setPane}
                options={[
                  { value: "yaml", label: "YAML" },
                  { value: "graph", label: "Graph" },
                ]}
                ariaLabel="Mapping view"
              />
            </>
          ) : (
            <IconButton onClick={() => sqlRef.current?.click()} title="Upload .sql">
              <Upload className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      </div>

      {/* Active-mapping tab: editable YAML + graph + validity. */}
      <div className={cls("flex min-h-0 flex-1 flex-col", sqlInner !== "mapping" && "hidden")}>
        <MappingBody
          yaml={mappingYaml}
          onChange={setMappingYaml}
          validity={validity}
          pane={pane}
          theme={theme}
          emptyHint="Upload a mapping, or build one in the Build mapping tab and click Use this mapping."
        />
        {validity && !validity.valid && validity.errors.length > 0 && <IssueStrip tone="error" lines={validity.errors} />}
        <FooterBar>
          {validity == null ? (
            <StatusText tone="muted">No mapping yet.</StatusText>
          ) : validity.valid ? (
            <StatusText tone="success">
              {validity.node_count} node{validity.node_count === 1 ? "" : "s"} · {validity.edge_count} edge
              {validity.edge_count === 1 ? "" : "s"}
            </StatusText>
          ) : (
            <StatusText tone="error">
              {validity.errors.length} error{validity.errors.length === 1 ? "" : "s"}
            </StatusText>
          )}
        </FooterBar>
      </div>

      {/* SQL tab: the query editor + live pre-flight. */}
      <div className={cls("flex min-h-0 flex-1 flex-col", sqlInner !== "sql" && "hidden")}>
        <div className="min-h-0 flex-1">
          <CodeEditor
            value={sql}
            onChange={setSql}
            language="sql"
            theme={theme}
            onSubmit={() => void translate()}
            placeholder="SELECT name FROM supplier WHERE suppkey = 1337"
          />
        </div>
        <SqlPreflightBanner />
        <FeatureChips />
      </div>

      <input
        ref={yamlRef}
        type="file"
        accept=".yaml,.yml,text/yaml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadYaml(f);
          e.target.value = "";
        }}
      />
      <input
        ref={sqlRef}
        type="file"
        accept=".sql,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadSql(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
