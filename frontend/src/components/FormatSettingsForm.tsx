import { useStore } from "@/hooks/useStore";
import { Field, Select } from "@/components/ui/primitives";
import type { Target } from "@/lib/types";

// SQL dialects for the build-mapping (DDL) flow. Radix Select needs a non-empty
// value, so "generic" is a sentinel that buildMapping() maps back to null.
const DIALECTS = [
  { value: "generic", label: "Generic SQL" },
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sqlite", label: "SQLite" },
  { value: "tsql", label: "SQL Server" },
  { value: "oracle", label: "Oracle" },
];

const TARGETS = [
  { value: "cypher", label: "Cypher" },
  { value: "aql", label: "AQL" },
  { value: "gremlin", label: "Gremlin" },
];

// The source SQL dialect (used to parse DDL/SQL) and the target graph query language.
// Kept in the sidebar so the top workspace bar stays lean (just the stage actions).
export function FormatSettingsForm() {
  const dialect = useStore((s) => s.form.dialect);
  const setDialect = useStore((s) => s.setDialect);
  const target = useStore((s) => s.form.target);
  const setTarget = useStore((s) => s.setTarget);

  return (
    <div className="space-y-3">
      <Field label="SQL dialect">
        <Select value={dialect} onChange={setDialect} options={DIALECTS} />
      </Field>
      <Field label="Target language">
        <Select value={target} onChange={(v) => setTarget(v as Target)} options={TARGETS} />
      </Field>
    </div>
  );
}
