import { useStore } from "../store";
import { Chip } from "./primitives";

export function FeatureChips() {
  const features = useStore((s) => s.features);
  if (features.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-3 py-1.5 dark:border-slate-700">
      <span className="text-[11px] font-medium text-slate-400">Detected SQL features →</span>
      {features.map((f) => (
        <Chip key={f} tone="indigo">
          {f}
        </Chip>
      ))}
    </div>
  );
}
