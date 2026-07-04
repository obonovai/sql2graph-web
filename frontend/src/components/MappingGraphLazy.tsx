// Lazy boundary for the graph view: Cytoscape.js + fcose are heavy and only needed
// once a user opens a Graph toggle, so they load on demand and stay out of the
// initial bundle. Same props as the underlying MappingGraph - import this instead.
import { lazy, Suspense } from "react";
import { Spinner } from "@/components/ui/primitives";
import type { GraphChanges } from "@/components/MappingGraph";
import type { MappingGraph as MappingGraphData } from "@/lib/types";

const MappingGraphImpl = lazy(() =>
  import("@/components/MappingGraph").then((m) => ({ default: m.MappingGraph })),
);

export function MappingGraph({
  graph,
  theme,
  changed,
}: {
  graph: MappingGraphData;
  theme: "light" | "dark";
  changed?: GraphChanges;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-slate-500">
          <Spinner />
        </div>
      }
    >
      <MappingGraphImpl graph={graph} theme={theme} changed={changed} />
    </Suspense>
  );
}
