// Live, as-you-type pre-flight banner for the SQL editor. Two severities via the
// shared <IssueStrip>:
//   · warning (amber): the SQL won't parse, but is still sent to the model.
//   · error   (rose):  the SQL reads tables, or names columns of a mapped table,
//                       absent from the mapping; translation would be rejected.
// Renders nothing when the query is clean. The neutral "Detected features" chips
// live in <FeatureChips /> below this; the two are deliberately not mixed.
import { useStore } from "@/hooks/useStore";
import { IssueStrip } from "@/components/ui/primitives";

export function SqlPreflightBanner() {
  const sqlParseOk = useStore((s) => s.sqlParseOk);
  const unmappedTables = useStore((s) => s.coverageUnmapped);
  const unmappedColumns = useStore((s) => s.coverageUnmappedColumns);

  // Both unmapped tables and unmapped columns are reject-level signals.
  const rejects: string[] = [];
  if (unmappedTables.length > 0) rejects.push(`Tables not in mapping: ${unmappedTables.join(", ")}`);
  if (unmappedColumns.length > 0) rejects.push(`Columns not in mapping: ${unmappedColumns.join(", ")}`);

  if (sqlParseOk && rejects.length === 0) return null;

  return (
    <div className="shrink-0">
      {!sqlParseOk && <IssueStrip tone="warning" lines={["SQL won't parse; it will still be sent to the model."]} />}
      {rejects.length > 0 && <IssueStrip tone="error" lines={rejects}/>}
    </div>
  );
}
