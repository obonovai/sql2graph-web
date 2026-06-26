// Settings-sidebar form: LLM provider + model + sampling knobs. Provider-specific
// fields toggle (Anthropic: max output tokens; Ollama: context window + repeat penalty).
import { useStore } from "@/hooks/useStore";
import { Field, NumberValueInput, Select, Slider, TextInput } from "@/components/ui/primitives";

export function LlmSettingsForm() {
  const llm = useStore((s) => s.form.llm);
  const setLlm = useStore((s) => s.setLlm);
  const setProvider = useStore((s) => s.setProvider);

  return (
    <div className="space-y-3">
      <Field label="Provider">
        <Select
          value={llm.provider}
          onChange={(v) => setProvider(v as "ollama" | "anthropic")}
          options={[
            { value: "anthropic", label: "Anthropic" },
            { value: "ollama", label: "Ollama" },
          ]}
        />
      </Field>

      <Field label="Model">
        <TextInput value={llm.model} onChange={(e) => setLlm({ model: e.target.value })} spellCheck={false} />
      </Field>

      <Field label="Temperature">
        <Slider value={llm.temperature} min={0} max={1} step={0.05} onChange={(v) => setLlm({ temperature: v })} />
      </Field>

      {llm.provider === "ollama" ? (
        <>
          <Field label="Context window (num_ctx)">
            <NumberValueInput double min={256} value={llm.num_ctx} onChange={(v) => setLlm({ num_ctx: v })} />
          </Field>
          <Field label="Repeat penalty">
            <Slider
              value={llm.repeat_penalty ?? 1.1}
              min={1}
              max={2}
              step={0.05}
              onChange={(v) => setLlm({ repeat_penalty: v })}
            />
          </Field>
        </>
      ) : (
        <Field label="Max output tokens">
          <NumberValueInput double min={1} value={llm.max_output_tokens} onChange={(v) => setLlm({ max_output_tokens: v })} />
        </Field>
      )}
    </div>
  );
}
