import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Download } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { MappingBody } from "@/components/MappingBody";
import { changedNames, isEmptyDiff } from "@/lib/diff";
import {
  Button,
  Chip,
  FooterBar,
  IconButton,
  IssueStrip,
  PaneHeader,
  SegmentedControl,
  StatusText,
} from "@/components/ui/primitives";
import type { MappingValidity } from "@/lib/types";

// The output pane of the Schema-mapping window: the editable DRAFT mapping (YAML) with a
// YAML|Graph view toggle and Download. The draft comes from Generate (the left DDL pane)
// or is typed here; the top workspace bar's "Use this mapping" promotes it to the active
// mapping. When the last Generate refined names with AI, a centered Refined|Original
// switch appears, the renamed names are highlighted green (with the original struck
// through), and the footer reports the run (duration + tokens), mirroring Translate.
export function MappingEditorPanel() {
  const draftYaml = useStore((s) => s.form.draftMappingYaml);
  const setDraftYaml = useStore((s) => s.setDraftMappingYaml);
  const useThisMapping = useStore((s) => s.useThisMapping);
  const draftValidity = useStore((s) => s.draftValidity);
  const result = useStore((s) => s.build.result);
  const buildStatus = useStore((s) => s.build.status);
  const buildError = useStore((s) => s.build.errorMessage);
  // The run report rides on the build result itself (no separate store fields).
  const duration = result?.duration_seconds;
  const tokens = result?.token_usage ?? null;
  const refineWithLlm = useStore((s) => s.form.refineWithLlm);
  const theme = useStore((s) => s.theme);
  const [pane, setPane] = useState<"yaml" | "graph">("yaml");
  const [view, setView] = useState<"refined" | "original">("refined");

  const diff = result?.diff ?? null;
  // `refined`: the AI changed the deterministic draft, so an Original comparison exists.
  // `hasChanges`: the diff also pinned down specific renames to highlight (stricter).
  const refined = !!result?.refined;
  const hasChanges = refined && !isEmptyDiff(diff);
  // A fresh build resets the view to the refined result (the default the user works on).
  useEffect(() => setView("refined"), [result]);
  const showingOriginal = refined && view === "original";

  const changed = useMemo(() => changedNames(diff), [diff]);

  // The read-only "Original" is the deterministic skeleton; synthesize a validity from
  // its structured graph so MappingBody's graph + the footer read from one shape.
  const skeletonValidity: MappingValidity | null = result
    ? {
        valid: true,
        errors: [],
        node_count: result.skeleton_graph.nodes.length,
        edge_count: result.skeleton_graph.edges.length,
        graph: result.skeleton_graph,
      }
    : null;

  const displayYaml = showingOriginal ? (result?.skeleton_yaml ?? "") : draftYaml;
  const displayValidity = showingOriginal ? skeletonValidity : draftValidity;

  const download = () => {
    if (!displayYaml.trim() || typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(new Blob([displayYaml], { type: "text/yaml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = showingOriginal ? "mapping.original.yaml" : "mapping.yaml";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Token breakdown tooltip, same shape as the Translate report (OutcomePanel).
  const tokenTitle = tokens
    ? `${tokens.input_tokens.toLocaleString()} in · ${tokens.output_tokens.toLocaleString()} out` +
      (tokens.cache_read_tokens > 0 || tokens.cache_creation_tokens > 0
        ? ` · cache ${tokens.cache_read_tokens.toLocaleString()} read / ${tokens.cache_creation_tokens.toLocaleString()} write`
        : "")
    : undefined;

  // The run report (duration + tokens) is meaningful only for a finished AI refinement.
  const showReport = buildStatus === "done" && refined && !showingOriginal;

  // The promote button names the version on screen: "refined"/"original" only when the
  // AI actually refined; otherwise the single deterministic draft is just "this mapping".
  const useLabel = !refined ? "Use this mapping" : showingOriginal ? "Use original mapping" : "Use refined mapping";

  return (
    <div className="flex h-full flex-col">
      <PaneHeader
        title="Schema mapping"
        center={
          refined ? (
            <SegmentedControl
              value={view}
              onChange={setView}
              options={[
                { value: "refined", label: "Refined" },
                { value: "original", label: "Original" },
              ]}
              ariaLabel="Refined or original mapping"
            />
          ) : undefined
        }
      >
        <div className="flex items-center gap-2">
          <SegmentedControl
            value={pane}
            onChange={setPane}
            options={[
              { value: "yaml", label: "YAML" },
              { value: "graph", label: "Graph" },
            ]}
            ariaLabel="Mapping view"
          />
          <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
          <IconButton onClick={download} disabled={!displayYaml.trim()} title="Download .yaml">
            <Download className="h-4 w-4" />
          </IconButton>
        </div>
      </PaneHeader>

      <MappingBody
        yaml={displayYaml}
        onChange={showingOriginal ? () => {} : setDraftYaml}
        readOnly={showingOriginal}
        validity={displayValidity}
        pane={pane}
        theme={theme}
        highlights={showingOriginal || !hasChanges ? undefined : changed.yamlRenames}
        changed={showingOriginal || !hasChanges ? undefined : changed}
        emptyHint="Enter DDL on the left and click Generate, or type YAML here."
        overlay={
          displayYaml.trim() ? (
            <div className="absolute bottom-3 right-6 z-10">
              <Button
                variant="primary"
                onClick={() => useThisMapping(displayYaml)}
                className="shadow-lg"
                title="Copy this mapping to the SQL window and switch there"
              >
                {useLabel} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ) : undefined
        }
      />

      {displayValidity && !displayValidity.valid && displayValidity.errors.length > 0 && (
        <IssueStrip tone="error" lines={displayValidity.errors} />
      )}
      {/* Footer mirrors the Translate report: a spinner + message while building, then
          node/edge counts and (for a finished AI refinement) the duration + token chips. */}
      <FooterBar>
        {buildStatus === "loading" ? (
          <StatusText tone="running">{refineWithLlm ? "Refining names…" : "Generating…"}</StatusText>
        ) : buildStatus === "error" ? (
          <StatusText tone="error">Error: {buildError ?? "generation failed"}</StatusText>
        ) : (
          <>
            {displayValidity == null ? (
              <StatusText tone="muted">No mapping yet.</StatusText>
            ) : displayValidity.valid ? (
              <StatusText tone="success">
                {displayValidity.node_count} node{displayValidity.node_count === 1 ? "" : "s"} ·{" "}
                {displayValidity.edge_count} edge{displayValidity.edge_count === 1 ? "" : "s"}
              </StatusText>
            ) : (
              <StatusText tone="error">
                {displayValidity.errors.length} error{displayValidity.errors.length === 1 ? "" : "s"}
              </StatusText>
            )}
            {showReport && <Chip>{(duration ?? 0).toFixed(2)}s</Chip>}
            {showReport && tokens && tokens.total_tokens > 0 && (
              <Chip title={tokenTitle}>{tokens.total_tokens.toLocaleString()} tokens</Chip>
            )}
          </>
        )}
      </FooterBar>
    </div>
  );
}
