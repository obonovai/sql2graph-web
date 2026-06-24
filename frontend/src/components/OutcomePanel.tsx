import type { ReactNode } from "react";
import { Copy, Download } from "lucide-react";
import { RUNNING_STATUSES, useStore } from "../store";
import { CodeEditor } from "./CodeEditor";
import { Chip, IconButton, PaneHeader, Spinner } from "./primitives";

const FILE_EXT: Record<string, string> = { cypher: "cypher", aql: "aql", gremlin: "groovy" };

const PHASE_LABEL: Record<string, string> = {
  provisioning: "Provisioning…",
  generating: "Generating…",
  validating: "Validating…",
  fixing: "Fixing…",
};

// Verdict-first view of the translation outcome: status badge + cost metrics +
// the generated query (copy / download) + structured validation errors. Absorbs
// the done/error semantics that used to live in the one-line StatusStrip.
export function OutcomePanel() {
  const target = useStore((s) => s.form.target);
  const theme = useStore((s) => s.theme);
  const status = useStore((s) => s.stream.status);
  const finalStatus = useStore((s) => s.stream.finalStatus);
  const passed = useStore((s) => s.stream.validationPassed);
  const generated = useStore((s) => s.stream.generatedQuery);
  const errors = useStore((s) => s.stream.validationErrors);
  const iterationsUsed = useStore((s) => s.stream.iterationsUsed);
  const currentIteration = useStore((s) => s.stream.currentIteration);
  const duration = useStore((s) => s.stream.durationSeconds);
  const tokens = useStore((s) => s.stream.tokenUsage);
  const errorMessage = useStore((s) => s.stream.errorMessage);

  const copy = () => generated && navigator.clipboard?.writeText(generated);
  const download = () => {
    if (!generated || typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(new Blob([generated], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `query.${FILE_EXT[target] ?? "txt"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  let verdict: ReactNode = "Result";
  if (RUNNING_STATUSES.has(status)) {
    verdict = (
      <span className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-300">
        <Spinner /> {PHASE_LABEL[status] ?? "Working…"}
      </span>
    );
  } else if (status === "error") {
    verdict = <Chip tone="red" size="md">Error</Chip>;
  } else if (status === "done") {
    verdict =
      passed !== false ? (
        <Chip tone="green" size="md">✓ success</Chip>
      ) : (
        <Chip tone={finalStatus === "stalled" ? "amber" : "red"} size="md">
          ✗ {finalStatus ?? "max_iterations_reached"}
        </Chip>
      );
  }

  const tokenTitle = tokens
    ? `${tokens.input_tokens.toLocaleString()} in · ${tokens.output_tokens.toLocaleString()} out` +
      (tokens.cache_read_tokens > 0 || tokens.cache_creation_tokens > 0
        ? ` · cache ${tokens.cache_read_tokens.toLocaleString()} read / ${tokens.cache_creation_tokens.toLocaleString()} write`
        : "")
    : undefined;

  return (
    <div className="flex h-full flex-col">
      <PaneHeader title={verdict}>
        <IconButton onClick={copy} disabled={!generated} title="Copy">
          <Copy className="h-4 w-4" />
        </IconButton>
        <IconButton onClick={download} disabled={!generated} title="Download">
          <Download className="h-4 w-4" />
        </IconButton>
      </PaneHeader>

      {status === "done" && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200 px-3 py-1.5 dark:border-slate-700">
          <Chip>{iterationsUsed ?? currentIteration} iteration(s)</Chip>
          <Chip>{(duration ?? 0).toFixed(2)}s</Chip>
          {tokens && tokens.total_tokens > 0 && (
            <Chip title={tokenTitle}>{tokens.total_tokens.toLocaleString()} tokens</Chip>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {generated ? (
          <CodeEditor value={generated} language="sql" readOnly theme={theme} />
        ) : status === "error" ? (
          <div className="flex h-full items-start justify-center overflow-y-auto px-4 py-6 text-center text-sm text-rose-600 dark:text-rose-400">
            {errorMessage ?? "Translation failed."}
          </div>
        ) : RUNNING_STATUSES.has(status) ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
            <Spinner /> Working…
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-slate-400">
            The translated query will appear here.
          </div>
        )}
      </div>

      {passed === false && errors.length > 0 && (
        <div className="max-h-28 shrink-0 overflow-y-auto border-t border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
          <div className="mb-0.5 font-semibold">Validation errors</div>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>• {e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
