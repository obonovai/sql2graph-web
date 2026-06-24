import { Copy, Download } from "lucide-react";
import { RUNNING_STATUSES, useStore } from "@/hooks/useStore";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { Chip, FooterBar, IconButton, PaneHeader, StatusText } from "@/components/ui/primitives";

const FILE_EXT: Record<string, string> = { cypher: "cypher", aql: "aql", gremlin: "groovy" };

// Result pane:
//  · header — the target language (left) + copy / download (right)
//  · body   — the generated query (read-only) or a placeholder
//  · footer — the live process status (db setup, LLM calls, validation) that
//             resolves, at the end, into the outcome badges (verdict + iterations
//             + duration + tokens).
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
  const stalled = useStore((s) => s.stream.stalled);

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

  const iters = iterationsUsed ?? currentIteration;
  const tokenTitle = tokens
    ? `${tokens.input_tokens.toLocaleString()} in · ${tokens.output_tokens.toLocaleString()} out` +
      (tokens.cache_read_tokens > 0 || tokens.cache_creation_tokens > 0
        ? ` · cache ${tokens.cache_read_tokens.toLocaleString()} read / ${tokens.cache_creation_tokens.toLocaleString()} write`
        : "")
    : undefined;

  const runningLabel =
    status === "provisioning"
      ? "Setting up database… (first run can take 10–40s)"
      : status === "generating"
        ? "Generating query…"
        : status === "validating"
          ? `Validating (iteration ${currentIteration})…`
          : stalled
            ? "Escalating (hotter retry)…"
            : "Fixing…";

  return (
    <div className="flex h-full flex-col">
      <PaneHeader title={target}>
        <div className="flex items-center gap-1">
          <IconButton onClick={copy} disabled={!generated} title="Copy">
            <Copy className="h-4 w-4" />
          </IconButton>
          <IconButton onClick={download} disabled={!generated} title="Download">
            <Download className="h-4 w-4" />
          </IconButton>
        </div>
      </PaneHeader>

      <div className="min-h-0 flex-1">
        {generated ? (
          <CodeEditor value={generated} language="sql" readOnly theme={theme} />
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

      {/* Process status → end-of-run outcome. Shared FooterBar + StatusText. */}
      <FooterBar>
        {status === "idle" && <StatusText tone="muted">Ready.</StatusText>}

        {RUNNING_STATUSES.has(status) && <StatusText tone="running">{runningLabel}</StatusText>}

        {status === "error" && <StatusText tone="error">Error: {errorMessage ?? "translation failed"}</StatusText>}

        {status === "done" && (
          <>
            {passed !== false ? (
              <StatusText tone="success">success</StatusText>
            ) : (
              <StatusText tone={finalStatus === "stalled" ? "warn" : "error"}>
                {finalStatus ?? "max_iterations_reached"}
              </StatusText>
            )}
            <Chip>
              {iters} iteration{iters === 1 ? "" : "s"}
            </Chip>
            <Chip>{(duration ?? 0).toFixed(2)}s</Chip>
            {tokens && tokens.total_tokens > 0 && <Chip title={tokenTitle}>{tokens.total_tokens.toLocaleString()} tokens</Chip>}
          </>
        )}
      </FooterBar>
    </div>
  );
}
