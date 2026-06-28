import { useEffect } from "react";
import { useStore } from "@/hooks/useStore";

// Debounced detection of the SQL features used by the query, fires 400ms after
// the last edit and pushes the result into `features`.
export function useFeatureDetection() {
  const sql = useStore((s) => s.form.sql);
  useEffect(() => {
    const t = setTimeout(() => void useStore.getState().refreshFeatures(), 400);
    return () => clearTimeout(t);
  }, [sql]);
}
