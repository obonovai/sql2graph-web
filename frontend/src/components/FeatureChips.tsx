import { useStore } from "../store";
import { Chip } from "./primitives";

export function FeatureChips() {
  const features = useStore((s) => s.features);
  if (features.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-slate-200 px-3 py-1.5 dark:border-slate-700">
      <span
        className="text-[11px] font-medium text-slate-400"
        title="Detected from your SQL — these tailor (and trim) the prompt sent to the model, so it only sees the rules your query needs."
      >
        Detected SQL features →
      </span>
      {features.map((f) => (
        <Chip key={f} tone="indigo">
          {f}
        </Chip>
      ))}
    </div>
  );
}
