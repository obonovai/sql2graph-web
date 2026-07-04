// Helpers over a MappingDiff (the renames the AI applied): the derived names that drive
// the green highlights in the YAML editor and the Cytoscape graph. Refinement only
// renames graph-facing names (node labels, edge types, property keys), so highlighting
// is a matter of matching those names; SQL identifiers/structure are never touched.
import type { MappingDiff, RenameDiff } from "@/lib/types";

// The AI-facing names to highlight, split by where they appear.
export interface ChangedNames {
  // after -> before: the proposed name (as it appears in the refined YAML) mapped to
  // the deterministic name it replaced (rendered struck-through beside it in the editor).
  yamlRenames: Map<string, string>;
  nodeLabels: Set<string>; // node labels to ring in the graph (renamed labels + property owners)
  edgeTypes: Set<string>; // edge types to ring in the graph (renamed types + property owners)
}

// All renames as one list, in a stable order (labels, then edge types, then properties).
// Module-private: only isEmptyDiff needs it; the UI consumes changedNames instead.
function allRenames(diff: MappingDiff): RenameDiff[] {
  return [...diff.label_renames, ...diff.edge_type_renames, ...diff.property_renames];
}

// True when there is no diff or the diff renamed nothing.
export function isEmptyDiff(diff: MappingDiff | null | undefined): boolean {
  return !diff || allRenames(diff).length === 0;
}

// Derive the highlight names from a diff. Each rename maps its `after` name (the AI's,
// as it appears in the refined mapping) to its `before` name (struck through beside it).
// A property rename's `where` is "Owner.column", so its owner label/type is ringed too.
export function changedNames(diff: MappingDiff | null | undefined): ChangedNames {
  const yamlRenames = new Map<string, string>();
  const nodeLabels = new Set<string>();
  const edgeTypes = new Set<string>();
  if (diff) {
    for (const r of diff.label_renames) {
      yamlRenames.set(r.after, r.before);
      nodeLabels.add(r.after);
    }
    for (const r of diff.edge_type_renames) {
      yamlRenames.set(r.after, r.before);
      edgeTypes.add(r.after);
    }
    for (const r of diff.property_renames) {
      yamlRenames.set(r.after, r.before);
      const owner = r.where.split(".")[0];
      // The owner is a node label or an edge type; ring whichever it turns out to be.
      if (owner) {
        nodeLabels.add(owner);
        edgeTypes.add(owner);
      }
    }
  }
  return { yamlRenames, nodeLabels, edgeTypes };
}
