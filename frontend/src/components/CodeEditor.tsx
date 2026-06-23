import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { useMemo } from "react";

export type Lang = "sql" | "yaml" | "none";

const transparentBg = EditorView.theme({
  "&": { backgroundColor: "transparent", height: "100%" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none" },
});

export function CodeEditor({
  value,
  onChange,
  language = "none",
  readOnly = false,
  theme,
  placeholder,
  onSubmit,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: Lang;
  readOnly?: boolean;
  theme: "light" | "dark";
  placeholder?: string;
  onSubmit?: () => void;
}) {
  const extensions = useMemo<Extension[]>(() => {
    const ext: Extension[] = [transparentBg, EditorView.lineWrapping];
    if (language === "sql") ext.push(sql());
    else if (language === "yaml") ext.push(yaml());
    if (onSubmit) {
      ext.push(
        EditorView.domEventHandlers({
          keydown: (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSubmit();
              return true;
            }
            return false;
          },
        }),
      );
    }
    return ext;
  }, [language, onSubmit]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={theme}
      height="100%"
      readOnly={readOnly}
      editable={!readOnly}
      placeholder={placeholder}
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
      }}
      className="h-full text-[13px]"
    />
  );
}
