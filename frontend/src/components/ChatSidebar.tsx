// Chat sidebar: routes the single shared <ConversationView> between the two AI
// streams. In build mode it shows the generate-mapping naming pass; otherwise it
// shows the live translation transcript. Read-only in both cases.
import { RUNNING_STATUSES, runningLabel, useStore } from "@/hooks/useStore";
import { ConversationView } from "@/components/ConversationView";

export function ChatSidebar() {
  const mappingView = useStore((s) => s.view === "mapping");
  const streamConversation = useStore((s) => s.stream.conversation);
  const streamStatus = useStore((s) => s.stream.status);
  const streamStalled = useStore((s) => s.stream.stalled);
  const streamIteration = useStore((s) => s.stream.currentIteration);
  const buildConversation = useStore((s) => s.build.conversation);
  const buildStatus = useStore((s) => s.build.status);

  const messages = mappingView ? buildConversation : streamConversation;
  const running = mappingView ? buildStatus === "loading" : RUNNING_STATUSES.has(streamStatus);
  const emptyHint = mappingView
    ? running
      ? "Refining names…"
      : "The AI naming pass will stream here when you Generate."
    : running
      ? // Status-aware so DB provisioning doesn't read as "waiting for the model".
        runningLabel(streamStatus, { stalled: streamStalled, currentIteration: streamIteration })
      : "The system ↔ LLM exchange will stream here.";

  return (
    <div className="flex h-full flex-col">
      <ConversationView messages={messages} streamingLast={running} emptyHint={emptyHint} />
    </div>
  );
}
