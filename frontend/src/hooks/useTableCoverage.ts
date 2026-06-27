import { useEffect } from "react";
import { useStore } from "@/hooks/useStore";

// Debounced live check of which SQL tables are absent from the schema mapping —
// fires 400ms after the last edit to *either* the SQL or the mapping (the check
// depends on both) and pushes the result into `coverageUnmapped`.
export function useTableCoverage() {
  const sql = useStore((s) => s.form.sql);
  const mappingYaml = useStore((s) => s.form.mappingYaml);
  useEffect(() => {
    const t = setTimeout(() => void useStore.getState().refreshCoverage(), 400);
    return () => clearTimeout(t);
  }, [sql, mappingYaml]);
}
