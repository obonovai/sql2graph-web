import { useStore } from "../store";
import { CodeEditor } from "./CodeEditor";
import { PaneHeader } from "./primitives";

export function SqlEditor() {
  const sql = useStore((s) => s.form.sql);
  const setSql = useStore((s) => s.setSql);
  const theme = useStore((s) => s.theme);
  const translate = useStore((s) => s.translate);

  return (
    <div className="flex h-full flex-col">
      <PaneHeader title="SQL" />
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
