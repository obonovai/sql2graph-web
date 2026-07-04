// Thin CodeMirror wrapper: a controlled SQL/YAML editor that fills its container,
// follows the light/dark theme, and submits on Cmd/Ctrl+Enter.
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { useMemo, useRef } from "react";

export type Lang = "sql" | "yaml" | "none";

const transparentBg = EditorView.theme({
  "&": { backgroundColor: "transparent", height: "100%" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none" },
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A non-editable inline widget rendering the deterministic (pre-refinement) name struck
// through, shown right after the AI's proposed name so the change reads in place.
class OldNameWidget extends WidgetType {
  constructor(readonly before: string) {
    super();
  }
  eq(other: OldNameWidget): boolean {
    return other.before === this.before;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-ai-old";
    span.setAttribute("contenteditable", "false");
    // No leading space in the text: the gap is a (non-struck) margin in CSS, so the
    // strikethrough covers only the old name, not the space before it.
    span.textContent = this.before;
    return span;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

// A view plugin that green-highlights (class `cm-ai-changed`) each AI-renamed name where
// it appears as a `label:`/`type:` value or a mapping key, and appends the deterministic
// name it replaced (struck through). `renames` maps each proposed name -> its original.
function highlightPlugin(renames: Map<string, string>): Extension {
  const mark = Decoration.mark({ class: "cm-ai-changed" });
  const alt = [...renames.keys()].map(escapeRegExp).join("|");
  // Group 1: the value after `label:`/`type:`. Group 2: a mapping key at line start.
  const re = new RegExp(`(?:\\b(?:label|type)\\s*:\\s*)(${alt})\\b|^\\s*(${alt})(?=\\s*:)`, "gm");

  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const name = m[1] ?? m[2];
        if (!name) continue;
        const start = from + m.index + m[0].lastIndexOf(name);
        const end = start + name.length;
        builder.add(start, end, mark);
        const before = renames.get(name);
        if (before) builder.add(end, end, Decoration.widget({ widget: new OldNameWidget(before), side: 1 }));
      }
    }
    return builder.finish();
  };

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export function CodeEditor({
  value,
  onChange,
  language = "none",
  readOnly = false,
  theme,
  placeholder,
  onSubmit,
  highlights,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: Lang;
  readOnly?: boolean;
  theme: "light" | "dark";
  placeholder?: string;
  onSubmit?: () => void;
  // AI-renamed names to green-highlight, mapping each proposed name -> the deterministic
  // name it replaced (shown struck through beside it). Empty/absent = none.
  highlights?: Map<string, string>;
}) {
  // Keep onSubmit in a ref so a new closure each render (callers rarely memoize
  // it) does not rebuild the extensions and reconfigure CodeMirror on every
  // keystroke; the memo depends only on whether a handler exists.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const hasSubmit = !!onSubmit;
  // A stable key so the extension list only rebuilds when the highlight map's contents
  // change, not on every render (Map identity is unstable).
  const highlightKey =
    highlights && highlights.size > 0
      ? [...highlights.entries()]
          .sort()
          .map(([after, before]) => `${after}=${before}`)
          .join("|")
      : "";
  const extensions = useMemo<Extension[]>(() => {
    const ext: Extension[] = [transparentBg, EditorView.lineWrapping];
    if (language === "sql") ext.push(sql());
    else if (language === "yaml") ext.push(yaml());
    if (highlights && highlights.size > 0) ext.push(highlightPlugin(highlights));
    if (hasSubmit) {
      ext.push(
        EditorView.domEventHandlers({
          keydown: (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSubmitRef.current?.();
              return true;
            }
            return false;
          },
        }),
      );
    }
    return ext;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, hasSubmit, highlightKey]);

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
