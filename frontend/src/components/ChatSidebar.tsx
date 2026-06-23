import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { IterationChip } from "../store";
import type { Message } from "../types";
import { Chip } from "./primitives";

const RUNNING = new Set(["generating", "validating", "fixing", "provisioning"]);

function ChipRibbon({ chips }: { chips: IterationChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
      {chips.map((c, i) => {
        if (c.kind === "validated")
          return c.passed ? (
            <Chip key={i} tone="green">
              iter {c.iteration} ✓
            </Chip>
          ) : (
            <Chip key={i} tone="red">
              iter {c.iteration} ✗ {c.errorCount}
            </Chip>
          );
        if (c.kind === "fix")
          return (
            <Chip key={i} tone="indigo">
              fix → iter {c.iteration + 1}
            </Chip>
          );
        return (
          <Chip key={i} tone="amber">
            max iters @ {c.iteration}
          </Chip>
        );
      })}
    </div>
  );
}

function SystemBubble({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md bg-slate-100 px-2.5 py-1.5 dark:bg-slate-800/60">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400"
      >
        <span>{open ? "▾" : "▸"}</span> system
        <span className="font-normal normal-case text-slate-400">({content.length} chars — schema + rules)</span>
      </button>
      {open && (
        <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          {content}
        </pre>
      )}
    </div>
  );
}

function Bubble({ msg, streaming }: { msg: Message; streaming: boolean }) {
  if (msg.role === "system") return <SystemBubble content={msg.content} />;
  const isUser = msg.role === "user";
  return (
    <div>
      <div
        className={
          "mb-0.5 text-[11px] font-semibold uppercase tracking-wide " +
          (isUser ? "text-sky-600 dark:text-sky-400" : "text-emerald-600 dark:text-emerald-400")
        }
      >
        {msg.role}
      </div>
      <pre
        className={
          "whitespace-pre-wrap break-words rounded-md px-2.5 py-1.5 text-[12px] leading-snug " +
          (isUser
            ? "bg-sky-50 text-slate-700 dark:bg-sky-950/30 dark:text-slate-200"
            : "bg-emerald-50 text-slate-800 dark:bg-emerald-950/20 dark:text-slate-100")
        }
      >
        {msg.content}
        {streaming && <span className="caret-blink">▋</span>}
      </pre>
    </div>
  );
}

export function ChatSidebar() {
  const conversation = useStore((s) => s.stream.conversation);
  const status = useStore((s) => s.stream.status);
  const chips = useStore((s) => s.stream.chips);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const running = RUNNING.has(status);
  const lastAssistant = conversation.length > 0 && conversation[conversation.length - 1].role === "assistant";

  useEffect(() => {
    if (stick && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  });

  return (
    <div className="flex h-full flex-col">
      <ChipRibbon chips={chips} />
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3"
      >
        {conversation.length === 0 ? (
          <p className="text-sm text-slate-400">
            {running ? "Waiting for the model…" : "The system ↔ LLM exchange will stream here."}
          </p>
        ) : (
          conversation.map((m, i) => (
            <Bubble key={i} msg={m} streaming={running && lastAssistant && i === conversation.length - 1} />
          ))
        )}
      </div>
    </div>
  );
}
