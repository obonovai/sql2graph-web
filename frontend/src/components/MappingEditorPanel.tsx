import { useState } from "react";
import { Download } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { MappingBody } from "@/components/MappingBody";
import { FooterBar, IconButton, IssueStrip, PaneHeader, SegmentedControl, StatusText } from "@/components/ui/primitives";

// The output pane of the Schema-mapping window: the editable DRAFT mapping (YAML) with
// a YAML|Graph view toggle and Download. The draft comes from Generate (the left DDL
// pane) or is typed here; the top workspace bar's "Use this mapping" promotes it to the
// active mapping. The footer is status-only (node/edge counts or validation errors).
export function MappingEditorPanel() {
  const draftYaml = useStore((s) => s.form.draftMappingYaml);
  const setDraftYaml = useStore((s) => s.setDraftMappingYaml);
  const validity = useStore((s) => s.draftValidity);
  const theme = useStore((s) => s.theme);
  const [pane, setPane] = useState<"yaml" | "graph">("yaml");

  const download = () => {
    if (!draftYaml.trim() || typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(new Blob([draftYaml], { type: "text/yaml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "mapping.yaml";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col">
      <PaneHeader title="Mapping">
        <div className="flex items-center gap-2">
          <IconButton onClick={download} disabled={!draftYaml.trim()} title="Download .yaml">
            <Download className="h-4 w-4" />
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
        </div>
      </PaneHeader>

      <MappingBody
        yaml={draftYaml}
        onChange={setDraftYaml}
        validity={validity}
        pane={pane}
        theme={theme}
        emptyHint="Enter DDL on the left and click Generate, or type YAML here."
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
  );
}
