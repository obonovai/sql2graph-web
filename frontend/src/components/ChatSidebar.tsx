// Chat sidebar: the live system↔LLM transcript, streamed token-by-token as
// collapsible System / User / Assistant bubbles, auto-sticking to the bottom.
import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronUp, Cog, User } from "lucide-react";
import { RUNNING_STATUSES, useStore } from "@/hooks/useStore";
import type { Message } from "@/lib/types";
import { cls } from "@/components/ui/primitives";

function SystemBubble({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <div className="flex justify-center">
      <div className="flex min-w-0 max-w-[85%] flex-col items-center">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          <Cog className="h-3.5 w-3.5" />
          <span>System</span>
          <Chevron className="h-3.5 w-3.5" />
        </button>
        <div
          className="w-full overflow-hidden transition-[max-height] duration-700 ease-in-out"
          style={{ maxHeight: open ? (contentRef.current?.scrollHeight ?? 0) : 0 }}
        >
          <div ref={contentRef} className="pt-1">
            <pre className="whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] leading-snug text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {content}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ msg, streaming }: { msg: Message; streaming: boolean }) {
  const isUser = msg.role === "user";
  const Icon = isUser ? User : Bot;
  return (
    <div className={cls("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cls("flex min-w-0 max-w-[85%] flex-col", isUser ? "items-end" : "items-start")}>
        <div
          className={cls(
            "mb-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide",
            isUser ? "text-sky-600 dark:text-sky-400" : "text-emerald-600 dark:text-emerald-400",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span>{isUser ? "User" : "Assistant"}</span>
        </div>
        <pre
          className={cls(
            "whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg border px-2.5 py-1.5 text-[12px] leading-snug",
            isUser
              ? "border-sky-200 bg-sky-50 text-slate-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-slate-200"
              : "border-emerald-200 bg-emerald-50 text-slate-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-slate-100",
          )}
        >
          {msg.content}
          {streaming && <span className="caret-blink">▋</span>}
        </pre>
      </div>
    </div>
  );
}

function Bubble({ msg, streaming }: { msg: Message; streaming: boolean }) {
  if (msg.role === "system") return <SystemBubble content={msg.content} />;
  return <ChatBubble msg={msg} streaming={streaming} />;
}

export function ChatSidebar() {
  const conversation = useStore((s) => s.stream.conversation);
  const status = useStore((s) => s.stream.status);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const running = RUNNING_STATUSES.has(status);
  const lastAssistant = conversation.length > 0 && conversation[conversation.length - 1].role === "assistant";

  useEffect(() => {
    if (stick && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  });

  return (
    <div className="flex h-full flex-col">
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
