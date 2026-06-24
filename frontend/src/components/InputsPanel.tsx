import type { ReactNode } from "react";
import { useRef } from "react";
import { useStore } from "../store";
import { CodeEditor } from "./CodeEditor";
import { FeatureChips } from "./FeatureChips";
import { Button, Select, cls } from "./primitives";

const MAPPING_PLACEHOLDER =
  "nodes:\n  - label: Person\n    source_table: person\n    properties:\n      name: first_name\n    primary_key: id\nedges: []";

// Underline-style tab. The buttons fill the bar's height (items-stretch) so the
// 2px active underline overlaps the bar's own border-b.
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cls(
        "inline-flex items-center gap-1.5 border-b-2 px-3 text-xs font-semibold uppercase tracking-wide transition-colors",
        active
          ? "border-indigo-500 text-indigo-600 dark:border-indigo-400 dark:text-indigo-300"
          : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
      )}
    >
      {children}
    </button>
  );
}

// The two primary inputs (schema mapping + SQL) as co-equal tabs. Both bodies stay
// mounted and toggle with the `hidden` class — never conditional render — so each
// CodeMirror keeps its cursor/scroll and is not torn down on every tab switch.
export function InputsPanel() {
  const tab = useStore((s) => s.inputTab);
  const setTab = useStore((s) => s.setInputTab);
  const mappingYaml = useStore((s) => s.form.mappingYaml);
  const setMappingYaml = useStore((s) => s.setMappingYaml);
  const sql = useStore((s) => s.form.sql);
  const setSql = useStore((s) => s.setSql);
  const presets = useStore((s) => s.presets);
  const applyPreset = useStore((s) => s.applyPreset);
  const validity = useStore((s) => s.mappingValidity);
  const theme = useStore((s) => s.theme);
  const refreshValidity = useStore((s) => s.refreshMappingValidity);
  const translate = useStore((s) => s.translate);
  const fileRef = useRef<HTMLInputElement>(null);

  const dot = validity == null ? "bg-slate-300" : validity.valid ? "bg-emerald-500" : "bg-rose-500";

  const onUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setMappingYaml(String(reader.result ?? ""));
      void refreshValidity();
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-stretch border-b border-slate-200 dark:border-slate-700">
        <Tab active={tab === "mapping"} onClick={() => setTab("mapping")}>
          <span className={cls("h-2 w-2 rounded-full", dot)} />
          Schema mapping
        </Tab>
        <Tab active={tab === "sql"} onClick={() => setTab("sql")}>
          SQL
        </Tab>
      </div>

      {/* Onboarding front-door: only on a fresh, empty workspace. */}
      {!mappingYaml.trim() && !sql.trim() && presets.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-300">
          <span>New here? Load a preset to fill the mapping + a sample query:</span>
          {presets.map((p) => (
            <Button key={p.name} variant="default" onClick={() => applyPreset(p.name)}>
              {p.name}
            </Button>
          ))}
        </div>
      )}

      {/* Schema-mapping tab */}
      <div className={cls("flex min-h-0 flex-1 flex-col", tab !== "mapping" && "hidden")}>
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Presets</span>
          <Select
            className="!w-auto"
            value=""
            placeholder="Load…"
            onChange={(v) => {
              if (v) applyPreset(v);
            }}
            options={presets.map((p) => ({ value: p.name, label: p.name }))}
          />
          <Button variant="default" onClick={() => fileRef.current?.click()}>
            Upload .yaml
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".yaml,.yml,text/yaml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
          <div className="ml-auto text-xs">
            {validity == null ? (
              <span className="text-slate-400">no mapping</span>
            ) : validity.valid ? (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                ✓ {validity.node_count} nodes · {validity.edge_count} edges
              </span>
            ) : (
              <span className="font-medium text-rose-600 dark:text-rose-400">✗ {validity.errors.length} error(s)</span>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <CodeEditor
            value={mappingYaml}
            onChange={setMappingYaml}
            language="yaml"
            theme={theme}
            placeholder={MAPPING_PLACEHOLDER}
          />
        </div>
        {validity && !validity.valid && validity.errors.length > 0 && (
          <ul className="max-h-24 shrink-0 overflow-y-auto border-t border-rose-100 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
            {validity.errors.map((e, i) => (
              <li key={i}>• {e}</li>
            ))}
          </ul>
        )}
      </div>

      {/* SQL tab */}
      <div className={cls("flex min-h-0 flex-1 flex-col", tab !== "sql" && "hidden")}>
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
        <FeatureChips />
      </div>
    </div>
  );
}
