import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RUNNING_STATUSES, useStore } from "./store";
import { CollapsibleSidebar } from "./components/Sidebar";
import { LlmSettingsForm } from "./components/LlmSettingsForm";
import { ValidationSettingsForm } from "./components/ValidationSettingsForm";
import { Header } from "./components/Header";
import { RunSetupBar } from "./components/RunSetupBar";
import { InputsPanel } from "./components/InputsPanel";
import { OutcomePanel } from "./components/OutcomePanel";
import { ChatSidebar } from "./components/ChatSidebar";
import { IterationTimeline } from "./components/IterationTimeline";
import { Section } from "./components/primitives";

function CollapsedChatRail() {
  const status = useStore((s) => s.stream.status);
  const iter = useStore((s) => s.stream.currentIteration);
  if (!RUNNING_STATUSES.has(status)) return null;
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
          <Header />
          <RunSetupBar />
          <div className="min-h-0 flex-1 p-2">
            <PanelGroup direction="horizontal" className="h-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <Panel defaultSize={50} minSize={25} className="bg-white dark:bg-slate-900">
                <InputsPanel />
              </Panel>
              <PanelResizeHandle className="w-1.5 bg-slate-200 transition-colors hover:bg-indigo-400 data-[resize-handle-state=drag]:bg-indigo-500 dark:bg-slate-700" />
              <Panel defaultSize={50} minSize={25} className="bg-white dark:bg-slate-900">
                <OutcomePanel />
              </Panel>
            </PanelGroup>
          </div>
          <IterationTimeline />
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
