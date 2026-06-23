import { useState } from "react";
import { useStore } from "../store";
import { Field, NumberInput, Select, Slider, TextInput } from "./primitives";

export function LlmSettingsForm() {
  const llm = useStore((s) => s.form.llm);
  const setLlm = useStore((s) => s.setLlm);
  const setProvider = useStore((s) => s.setProvider);
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-3">
      <Field label="Provider">
        <Select value={llm.provider} onChange={(e) => setProvider(e.target.value as "ollama" | "anthropic")}>
          <option value="anthropic">Anthropic</option>
          <option value="ollama">Ollama</option>
        </Select>
      </Field>

      <Field
        label="Model"
        hint={llm.provider === "anthropic" ? "e.g. claude-opus-4-7 — only checked when the call runs" : "must be pulled on the Ollama server"}
      >
        <TextInput value={llm.model} onChange={(e) => setLlm({ model: e.target.value })} spellCheck={false} />
      </Field>

      <Field label={`Temperature — ${llm.temperature.toFixed(2)}`}>
        <Slider value={llm.temperature} min={0} max={1} step={0.05} onChange={(v) => setLlm({ temperature: v })} />
      </Field>

      {llm.provider === "ollama" ? (
        <Field label="Context window (num_ctx)" hint="tokens; raise for large schemas / many fixes">
          <NumberInput
            min={256}
            value={llm.num_ctx ?? 8192}
            onChange={(e) => setLlm({ num_ctx: Number(e.target.value) })}
          />
        </Field>
      ) : (
        <Field label="Max output tokens">
          <NumberInput
            min={1}
            value={llm.max_output_tokens ?? 4096}
            onChange={(e) => setLlm({ max_output_tokens: Number(e.target.value) })}
          />
        </Field>
      )}

      <Field label="Max retries" hint="LLM connection retries (not fix iterations)">
        <NumberInput min={0} value={llm.max_retries} onChange={(e) => setLlm({ max_retries: Number(e.target.value) })} />
      </Field>

      {llm.provider === "anthropic" && (
        <p className="rounded-md bg-slate-100 px-2 py-1.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          API key is read from the server's <code>ANTHROPIC_API_KEY</code> — no key needed here.
        </p>
      )}

      {llm.provider === "ollama" && (
        <div>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {showAdvanced ? "Hide" : "Show"} advanced
          </button>
          {showAdvanced && (
            <div className="mt-2">
              <Field label="Host override" hint="blank = server's OLLAMA_HOST env">
                <TextInput
                  placeholder="http://localhost:11434"
                  value={llm.host ?? ""}
                  onChange={(e) => setLlm({ host: e.target.value })}
                  spellCheck={false}
                />
              </Field>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
