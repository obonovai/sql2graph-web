import { useEffect } from "react";
import { useStore } from "@/hooks/useStore";

// Debounced live validation of the schema-mapping YAML — fires 400ms after the
// last edit and pushes the result into `mappingValidity`.
export function useMappingValidation() {
  const mappingYaml = useStore((s) => s.form.mappingYaml);
  useEffect(() => {
    const t = setTimeout(() => void useStore.getState().refreshMappingValidity(), 400);
    return () => clearTimeout(t);
  }, [mappingYaml]);
}
