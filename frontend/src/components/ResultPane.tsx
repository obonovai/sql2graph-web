import { Copy } from "lucide-react";
import { useStore } from "../store";
import { CodeEditor } from "./CodeEditor";
import { IconButton, PaneHeader } from "./primitives";

export function ResultPane() {
  const target = useStore((s) => s.form.target);
  const theme = useStore((s) => s.theme);
  const generated = useStore((s) => s.stream.generatedQuery);
  const passed = useStore((s) => s.stream.validationPassed);
  const errors = useStore((s) => s.stream.validationErrors);
  const status = useStore((s) => s.stream.status);

  const copy = () => generated && navigator.clipboard.writeText(generated);

  return (
    <div className="flex h-full flex-col">
      <PaneHeader title={target}>
        <IconButton onClick={copy} disabled={!generated} title="Copy">
          <Copy className="h-4 w-4" />
        </IconButton>
      </PaneHeader>
      <div className="min-h-0 flex-1">
        {generated ? (
          <CodeEditor value={generated} language="sql" readOnly theme={theme} />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-slate-400">
            {status === "idle" ? "The translated query will appear here." : "…"}
          </div>
        )}
      </div>
      {passed === false && errors.length > 0 && (
        <div className="max-h-28 overflow-y-auto border-t border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
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
