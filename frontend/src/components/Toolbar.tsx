import { useStore } from "../store";
import { Chip, IconButton, Select, cls } from "./primitives";

export function Toolbar() {
  const target = useStore((s) => s.form.target);
  const setTarget = useStore((s) => s.setTarget);
  const provider = useStore((s) => s.form.llm.provider);
  const model = useStore((s) => s.form.llm.model);
  const mode = useStore((s) => s.form.validation.mode);
  const mappingOpen = useStore((s) => s.mappingOpen);
  const setMappingOpen = useStore((s) => s.setMappingOpen);
  const mappingValidity = useStore((s) => s.mappingValidity);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  const dot = mappingValidity == null ? "bg-slate-300" : mappingValidity.valid ? "bg-emerald-500" : "bg-rose-500";

  return (
    <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Target</span>
        <Select value={target} onChange={(e) => setTarget(e.target.value as never)} className="!w-auto">
          <option value="cypher">Cypher</option>
          <option value="aql">AQL</option>
          <option value="gremlin">Gremlin</option>
        </Select>
      </div>

      <button
        onClick={() => setMappingOpen(!mappingOpen)}
        className={cls(
          "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm",
          "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
        )}
        title="Toggle the schema-mapping editor"
      >
        <span className={cls("h-2 w-2 rounded-full", dot)} />
        <span>Schema mapping (YAML)</span>
        <span className="text-slate-400">{mappingOpen ? "▾" : "▸"}</span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <Chip tone="indigo" title="Active model">
          {provider} / {model}
        </Chip>
        <Chip title="Validation mode">{mode}</Chip>
        <IconButton onClick={toggleTheme} title="Toggle light/dark">
          {theme === "light" ? "☾" : "☀"}
        </IconButton>
      </div>
    </div>
  );
}
