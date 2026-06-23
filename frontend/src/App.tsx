import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useStore } from "./store";
import { CollapsibleSidebar } from "./components/Sidebar";
import { LlmSettingsForm } from "./components/LlmSettingsForm";
import { ValidationSettingsForm } from "./components/ValidationSettingsForm";
import { Toolbar } from "./components/Toolbar";
import { MappingDrawer } from "./components/MappingDrawer";
import { FeatureChips } from "./components/FeatureChips";
import { SqlEditor } from "./components/SqlEditor";
import { ResultPane } from "./components/ResultPane";
import { ChatSidebar } from "./components/ChatSidebar";
import { StatusStrip } from "./components/StatusStrip";
import { Button, Section } from "./components/primitives";

const RUNNING = new Set(["generating", "validating", "fixing", "provisioning"]);

function Actions() {
  const sql = useStore((s) => s.form.sql);
  const validity = useStore((s) => s.mappingValidity);
  const status = useStore((s) => s.stream.status);
  const translate = useStore((s) => s.translate);
  const stop = useStore((s) => s.stop);
  const clearWorkspace = useStore((s) => s.clearWorkspace);
  const resetAll = useStore((s) => s.resetAll);

  const running = RUNNING.has(status);
  const canTranslate = !running && !!sql.trim() && !!validity?.valid;

  return (
    <div className="flex items-center justify-center gap-2 border-t border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
      {running ? (
        <Button variant="danger" onClick={stop}>
          ◼ Stop
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={() => void translate()}
          disabled={!canTranslate}
          title={!sql.trim() ? "Enter a SQL query" : !validity?.valid ? "Provide a valid schema mapping" : "Translate"}
        >
          ▸ Translate
        </Button>
      )}
      <Button variant="default" onClick={clearWorkspace} disabled={running}>
        Clear
      </Button>
      <button
        onClick={resetAll}
        disabled={running}
        className="ml-2 text-[11px] text-slate-400 hover:text-slate-600 disabled:opacity-40 dark:hover:text-slate-200"
      >
        reset all
      </button>
    </div>
  );
}

function CollapsedChatRail() {
  const status = useStore((s) => s.stream.status);
  const iter = useStore((s) => s.stream.currentIteration);
  if (!RUNNING.has(status)) return null;
  return (
    <div className="mt-1 flex flex-col items-center gap-1">
      <span className="h-2 w-2 animate-ping rounded-full bg-indigo-500" />
      {iter > 0 && <span className="text-[10px] font-semibold text-indigo-500">{iter}</span>}
    </div>
  );
}

export default function App() {
  const theme = useStore((s) => s.theme);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const mappingOpen = useStore((s) => s.mappingOpen);
  const setLeftOpen = useStore((s) => s.setLeftOpen);
  const setRightOpen = useStore((s) => s.setRightOpen);
  const mappingYaml = useStore((s) => s.form.mappingYaml);
  const sql = useStore((s) => s.form.sql);

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Debounced live mapping validation.
  useEffect(() => {
    const t = setTimeout(() => void useStore.getState().refreshMappingValidity(), 400);
    return () => clearTimeout(t);
  }, [mappingYaml]);

  // Debounced SQL feature detection.
  useEffect(() => {
    const t = setTimeout(() => void useStore.getState().refreshFeatures(), 400);
    return () => clearTimeout(t);
  }, [sql]);

  return (
    <div className="flex h-full w-full flex-col bg-white text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <main className="flex min-h-0 flex-1">
        <CollapsibleSidebar side="left" open={leftOpen} onToggle={setLeftOpen} title="Settings">
          <Section title="LLM settings">
            <LlmSettingsForm />
          </Section>
          <Section title="Validation settings">
            <ValidationSettingsForm />
          </Section>
        </CollapsibleSidebar>

        <section className="flex min-w-0 flex-1 flex-col">
          <Toolbar />
          {mappingOpen && <MappingDrawer />}
          <FeatureChips />
          <div className="min-h-0 flex-1 p-2">
            <PanelGroup direction="horizontal" className="h-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <Panel defaultSize={50} minSize={20} className="bg-white dark:bg-slate-900">
                <SqlEditor />
              </Panel>
              <PanelResizeHandle className="w-1.5 bg-slate-200 transition-colors hover:bg-indigo-400 data-[resize-handle-state=drag]:bg-indigo-500 dark:bg-slate-700" />
              <Panel defaultSize={50} minSize={20} className="bg-white dark:bg-slate-900">
                <ResultPane />
              </Panel>
            </PanelGroup>
          </div>
          <StatusStrip />
          <Actions />
        </section>

        <CollapsibleSidebar
          side="right"
          open={rightOpen}
          onToggle={setRightOpen}
          title="Chat"
          width={360}
          rail={<CollapsedChatRail />}
        >
          <ChatSidebar />
        </CollapsibleSidebar>
      </main>
    </div>
  );
}
