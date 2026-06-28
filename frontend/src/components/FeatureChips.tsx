// SQL footer: the detected-feature chips, which SQL features the translator found
// in the query (these tailor/trim the prompt sent to the model). Hidden when empty.
// Pre-flight *problems* (won't parse / unmapped tables / unmapped columns) are a
// separate concern and render in <SqlPreflightBanner /> above this footer.
import { useStore } from "@/hooks/useStore";
import { Chip, FooterBar } from "@/components/ui/primitives";

export function FeatureChips() {
  const features = useStore((s) => s.features);
  if (features.length === 0) return null;
  return (
    <FooterBar>
      <span
        className="text-xs font-medium text-slate-400"
        title="Detected from your SQL: these tailor (and trim) the prompt sent to the model, so it only sees the rules your query needs."
      >
        Detected features:
      </span>
      {features.map((f) => (
        <Chip key={f} tone="indigo">
          {f}
        </Chip>
      ))}
    </FooterBar>
  );
}
