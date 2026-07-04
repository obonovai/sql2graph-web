import type { ReactNode } from "react";
import { Database } from "lucide-react";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { MappingGraph } from "@/components/MappingGraphLazy";
import type { GraphChanges } from "@/components/MappingGraph";
import { cls } from "@/components/ui/primitives";
import type { MappingValidity } from "@/lib/types";

const MAPPING_PLACEHOLDER =
  "nodes:\n  - label: Person\n    source_table: person\n    properties:\n      name: first_name\n    primary_key: id\nedges: []";

// The shared body of a mapping pane: an editable (or read-only) YAML editor with an
// empty-state overlay, hidden under the lazy Cytoscape graph per the `pane` toggle.
// Used by both the draft mapping pane (Schema-mapping window) and the active mapping
// pane (SQL window). The YAML|Graph toggle + header actions live in each parent.
export function MappingBody({
  yaml,
  onChange,
  readOnly = false,
  validity,
  pane,
  emptyHint,
  theme,
  highlights,
  changed,
  overlay,
}: {
  yaml: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  validity: MappingValidity | null;
  pane: "yaml" | "graph";
  emptyHint: ReactNode;
  theme: "light" | "dark";
  // AI-rename highlights (both optional): `highlights` maps each proposed name -> the
  // original it replaced (green-marked + struck-through in the YAML editor); `changed`
  // = node labels / edge types to green-ring in the graph.
  highlights?: Map<string, string>;
  changed?: GraphChanges;
  // Absolutely-positioned content floated over the editor/graph viewport (e.g. a
  // bottom-right action button). Stays put while the YAML scrolls or the graph pans.
  overlay?: ReactNode;
}) {
  return (
    <div className="relative min-h-0 flex-1">
      {/* YAML editor stays mounted (hidden under the graph) so CodeMirror keeps its
          cursor/scroll when toggling back. */}
      <div className={cls("h-full", pane === "graph" && "hidden")}>
        <CodeEditor
          value={yaml}
          onChange={onChange}
          language="yaml"
          theme={theme}
          readOnly={readOnly}
          placeholder={MAPPING_PLACEHOLDER}
          highlights={highlights}
        />
        {!yaml.trim() && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <div className="flex max-w-xs flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-6 py-5 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
              <Database className="h-6 w-6 text-slate-400 dark:text-slate-500" />
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">No mapping yet</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">{emptyHint}</span>
            </div>
          </div>
        )}
      </div>
      {/* Graph view: the structured graph comes from the (debounced) validation, so it
          updates as the YAML is edited and only when valid. */}
      {pane === "graph" &&
        (validity?.graph ? (
          <MappingGraph graph={validity.graph} theme={theme} changed={changed} />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400 dark:text-slate-500">
            {yaml.trim() ? "Fix the mapping errors to see the graph." : "Add a mapping to see its graph."}
          </div>
        ))}
      {overlay}
    </div>
  );
}
