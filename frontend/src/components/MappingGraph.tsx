// Visualize a schema mapping as a Neo4j-style force-directed graph: circular nodes
// (one per graph label, colored per label), relationship lines labeled by edge type,
// draggable with zoom/pan, and a click inspector for a node's/edge's SQL details.
// Rendered with Cytoscape.js + fcose. Driven by the backend's structured `graph`, so
// there is no YAML parsing here. Heavy, so it is loaded via MappingGraphLazy.
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import cytoscape from "cytoscape";
import type { Core, EdgeSingular, ElementDefinition, NodeSingular } from "cytoscape";
import fcose from "cytoscape-fcose";
import type { GraphEdge, GraphNode, MappingGraph as MappingGraphData } from "@/lib/types";

cytoscape.use(fcose);

// Stable per-label color: hash the label into a fixed palette so each node label gets
// a consistent, distinct color (like the Neo4j browser).
const PALETTE = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#84cc16", // lime
];

function colorFor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Node labels / edge types the AI renamed (or that own a renamed property); ringed green.
export interface GraphChanges {
  nodeLabels: Set<string>;
  edgeTypes: Set<string>;
}

function toElements(graph: MappingGraphData, changed?: GraphChanges): ElementDefinition[] {
  const nodes: ElementDefinition[] = graph.nodes.map((node) => ({
    data: { id: node.label, label: node.label, color: colorFor(node.label), node },
    classes: changed?.nodeLabels.has(node.label) ? "changed" : undefined,
  }));
  const edges: ElementDefinition[] = graph.edges.map((edge, i) => ({
    data: {
      id: `e${i}-${edge.source_node}-${edge.type}-${edge.target_node}`,
      source: edge.source_node,
      target: edge.target_node,
      label: edge.type,
      edge,
    },
    classes: changed?.edgeTypes.has(edge.type) ? "changed" : undefined,
  }));
  return [...nodes, ...edges];
}

function stylesheet(theme: "light" | "dark"): cytoscape.StylesheetCSS[] {
  const dark = theme === "dark";
  const edge = dark ? "#64748b" : "#94a3b8";
  const edgeLabel = dark ? "#cbd5e1" : "#475569";
  const labelBg = dark ? "#0f172a" : "#ffffff";
  const selected = dark ? "#818cf8" : "#4f46e5";
  const style: unknown[] = [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        label: "data(label)",
        width: 56,
        height: 56,
        "border-width": 2,
        "border-color": dark ? "#0f172a" : "#ffffff",
        color: "#ffffff",
        "font-size": 11,
        "font-weight": 600,
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "wrap",
        "text-max-width": "52px",
      },
    },
    // AI-renamed nodes/edges get a green ring (green-500), before :selected so a
    // selection still overrides it visually.
    { selector: "node.changed", style: { "border-width": 4, "border-color": "#22c55e" } },
    { selector: "node:selected", style: { "border-width": 4, "border-color": selected } },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "line-color": edge,
        "target-arrow-color": edge,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        "curve-style": "bezier",
        label: "data(label)",
        "font-size": 9,
        color: edgeLabel,
        "text-background-color": labelBg,
        "text-background-opacity": 0.85,
        "text-background-padding": "2px",
        "text-rotation": "autorotate",
      },
    },
    {
      selector: "edge.changed",
      style: { width: 3, "line-color": "#22c55e", "target-arrow-color": "#22c55e" },
    },
    {
      selector: "edge:selected",
      style: { width: 3, "line-color": selected, "target-arrow-color": selected, color: selected },
    },
  ];
  return style as cytoscape.StylesheetCSS[];
}

const FCOSE_LAYOUT = {
  name: "fcose",
  quality: "default",
  animate: true,
  animationDuration: 300,
  randomize: true,
  idealEdgeLength: 130,
  nodeSeparation: 110,
  nodeRepulsion: 9000,
  padding: 30,
  fit: true,
} as unknown as cytoscape.LayoutOptions;

type Selection = { kind: "node"; data: GraphNode } | { kind: "edge"; data: GraphEdge } | null;

export function MappingGraph({
  graph,
  theme,
  changed,
}: {
  graph: MappingGraphData;
  theme: "light" | "dark";
  changed?: GraphChanges;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selected, setSelected] = useState<Selection>(null);

  // Key the (re)build on graph *content*, not object identity: the main editor's
  // debounced validation returns a fresh object on every keystroke, but we only
  // want to rebuild + relayout when the actual nodes/edges change (so editing a
  // comment doesn't reshuffle the graph).
  const signature = useMemo(() => JSON.stringify(graph), [graph]);
  // Fold the green-ring sets into the rebuild key so toggling highlights re-tags.
  const changedKey = useMemo(
    () =>
      changed ? `${[...changed.nodeLabels].sort().join(",")}|${[...changed.edgeTypes].sort().join(",")}` : "",
    [changed],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const elements = useMemo(() => toElements(graph, changed), [signature, changedKey]);

  // (Re)build the Cytoscape instance when the graph's elements change.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || graph.nodes.length === 0) return;
    const cy = cytoscape({
      container,
      elements,
      style: stylesheet(theme),
      layout: FCOSE_LAYOUT,
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
    });
    cyRef.current = cy;
    setSelected(null);

    cy.on("tap", "node", (evt) => setSelected({ kind: "node", data: (evt.target as NodeSingular).data("node") }));
    cy.on("tap", "edge", (evt) => setSelected({ kind: "edge", data: (evt.target as EdgeSingular).data("edge") }));
    cy.on("tap", (evt) => {
      if (evt.target === cy) setSelected(null);
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // Rebuild only on element changes; theme restyles in place via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements]);

  // Restyle in place on theme change (no relayout, keeps node positions).
  useEffect(() => {
    cyRef.current?.style(stylesheet(theme));
  }, [theme]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400 dark:text-slate-500">
        No nodes to display.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <InspectorPanel selection={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function InspectorPanel({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  if (!selection) return null;
  return (
    <div className="absolute right-2 top-2 max-h-[calc(100%-1rem)] w-60 overflow-auto rounded-lg border border-slate-200 bg-white/95 p-3 text-left shadow-md backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {selection.kind === "node" ? "Node" : "Relationship"}
        </span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {selection.kind === "node" ? <NodeDetails node={selection.data} /> : <EdgeDetails edge={selection.data} />}
    </div>
  );
}

function NodeDetails({ node }: { node: GraphNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{node.label}</div>
      <Meta label="table" value={node.source_table} />
      <Meta label="primary key" value={node.primary_key} />
      <PropList title="properties" properties={node.properties} propertyTypes={node.property_types} />
    </div>
  );
}

function EdgeDetails({ edge }: { edge: GraphEdge }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{edge.type}</div>
      <Meta label="from / to" value={`${edge.source_node} to ${edge.target_node}`} />
      <Meta label="table" value={edge.source_table} />
      <Meta label="join" value={`${edge.source_foreign_key} = ${edge.target_primary_key}`} />
      <PropList title="properties" properties={edge.properties} propertyTypes={edge.property_types} />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-200" title={value}>
        {value}
      </span>
    </div>
  );
}

// Properties whose graph key equals the SQL column (an identity mapping) show the key
// once; only a renamed column gets the muted second token. This avoids the noisy
// "name / name" rows of the old card. A declared semantic type (date, datetime,
// integer, ...) rides along as a muted badge on the right.
function PropList({
  title,
  properties,
  propertyTypes,
}: {
  title: string;
  properties: Record<string, string>;
  propertyTypes?: Record<string, string>;
}) {
  const entries = Object.entries(properties);
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      {entries.length === 0 ? (
        <div className="text-[11px] italic text-slate-400 dark:text-slate-500">none</div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {entries.map(([key, column]) => {
            const type = propertyTypes?.[key];
            return (
              <div key={key} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="truncate font-medium text-slate-700 dark:text-slate-200" title={key}>
                  {key}
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  {key !== column && (
                    <span className="truncate text-slate-400 dark:text-slate-500" title={`SQL column: ${column}`}>
                      {column}
                    </span>
                  )}
                  {type && (
                    <span
                      className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      title={`type: ${type}`}
                    >
                      {type}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
