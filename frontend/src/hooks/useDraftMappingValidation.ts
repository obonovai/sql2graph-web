import { useEffect } from "react";
import { useStore } from "@/hooks/useStore";

// Debounced live validation of the DRAFT schema-mapping YAML (the Schema-mapping
// window's output), mirroring useMappingValidation for the active mapping. Fires
// 400ms after the last edit and pushes the result into `draftValidity`.
export function useDraftMappingValidation() {
  const draftMappingYaml = useStore((s) => s.form.draftMappingYaml);
  useEffect(() => {
    const t = setTimeout(() => void useStore.getState().refreshDraftValidity(), 400);
    return () => clearTimeout(t);
  }, [draftMappingYaml]);
}
