import { ChevronDown, Moon, Sun } from "lucide-react";
import { useStore } from "../store";
import { Button, Chip, IconButton, Select, cls } from "./primitives";

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

      <Button
        variant="default"
        className="h-9"
        onClick={() => setMappingOpen(!mappingOpen)}
        title="Toggle the schema-mapping editor"
      >
        <span className={cls("h-2 w-2 rounded-full", dot)} />
        Schema mapping (YAML)
        <ChevronDown
          className={cls("h-3.5 w-3.5 text-slate-400 transition-transform", mappingOpen && "rotate-180")}
        />
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <Chip tone="indigo" size="md" title="Active model">
          {provider} / {model}
        </Chip>
        <Chip size="md" title="Validation mode">
          {mode}
        </Chip>
        <IconButton onClick={toggleTheme} title="Toggle light/dark">
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </IconButton>
      </div>
    </div>
  );
}
