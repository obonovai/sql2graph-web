import { useStore } from "../store";
import { CodeEditor } from "./CodeEditor";

export function SqlEditor() {
  const sql = useStore((s) => s.form.sql);
  const setSql = useStore((s) => s.setSql);
  const theme = useStore((s) => s.theme);
  const translate = useStore((s) => s.translate);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5 dark:border-slate-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          SQL input
        </span>
        <span className="text-[11px] text-slate-400">⌘/Ctrl + ↵ to translate</span>
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor
          value={sql}
          onChange={setSql}
          language="sql"
          theme={theme}
          onSubmit={() => void translate()}
          placeholder="SELECT name FROM supplier WHERE suppkey = 1337"
        />
      </div>
    </div>
  );
}
