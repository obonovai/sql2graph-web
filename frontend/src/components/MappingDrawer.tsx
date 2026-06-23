import { useRef } from "react";
import { useStore } from "../store";
import { CodeEditor } from "./CodeEditor";
import { Button, Select, cls } from "./primitives";

export function MappingDrawer() {
  const mappingYaml = useStore((s) => s.form.mappingYaml);
  const setMappingYaml = useStore((s) => s.setMappingYaml);
  const presets = useStore((s) => s.presets);
  const applyPreset = useStore((s) => s.applyPreset);
  const validity = useStore((s) => s.mappingValidity);
  const theme = useStore((s) => s.theme);
  const refreshValidity = useStore((s) => s.refreshMappingValidity);
  const fileRef = useRef<HTMLInputElement>(null);

  const onUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setMappingYaml(String(reader.result ?? ""));
      void refreshValidity();
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-2 px-3 py-2">
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

      <div className={cls("h-48 overflow-hidden border-t border-slate-100 dark:border-slate-800")}>
        <CodeEditor
          value={mappingYaml}
          onChange={setMappingYaml}
          language="yaml"
          theme={theme}
          placeholder={"nodes:\n  - label: Person\n    source_table: person\n    properties:\n      name: first_name\n    primary_key: id\nedges: []"}
        />
      </div>

      {validity && !validity.valid && validity.errors.length > 0 && (
        <ul className="max-h-24 overflow-y-auto border-t border-rose-100 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
          {validity.errors.map((e, i) => (
            <li key={i}>• {e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
