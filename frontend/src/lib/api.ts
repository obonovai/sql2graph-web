// Typed client for the FastAPI backend: small REST helpers (options,
// validate-mapping, detect-features) and the `translate` Server-Sent-Events stream
// that the store consumes. Adds no logic of its own, just fetch + typing.
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type {
  BuildMappingSseEvent,
  CoverageCheck,
  FeatureDetection,
  GeneratedMapping,
  LlmSettings,
  MappingValidity,
  Message,
  Options,
  SseEvent,
  TranslateRequest,
} from "@/lib/types";

export async function getOptions(): Promise<Options> {
  const r = await fetch("/api/options");
  if (!r.ok) throw new Error(`/api/options ${r.status}`);
  return r.json();
}

export async function validateMapping(mapping_yaml: string): Promise<MappingValidity> {
  const r = await fetch("/api/validate-mapping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapping_yaml }),
  });
  if (!r.ok) throw new Error(`/api/validate-mapping ${r.status}`);
  return r.json();
}

export async function detectFeatures(sql: string, dialect: string | null): Promise<FeatureDetection> {
  const r = await fetch("/api/detect-features", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, dialect }),
  });
  if (!r.ok) throw new Error(`/api/detect-features ${r.status}`);
  return r.json();
}

export async function checkCoverage(sql: string, mapping_yaml: string, dialect: string | null): Promise<CoverageCheck> {
  const r = await fetch("/api/check-coverage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, mapping_yaml, dialect }),
  });
  if (!r.ok) throw new Error(`/api/check-coverage ${r.status}`);
  return r.json();
}

class FatalSseError extends Error {}

/**
 * Open the build-mapping stream. The structure is derived deterministically; when
 * `refine` is true the LLM naming pass also runs, streaming `conversation` snapshots.
 * Either way a final `done` (the full GeneratedMapping) or `error` follows. Pass an
 * AbortSignal so the modal can cancel on close.
 */
export function buildMappingStream(
  req: { ddl: string; dialect: string | null; llm: LlmSettings; refine: boolean },
  handlers: {
    signal: AbortSignal;
    onConversation: (messages: Message[]) => void;
    onDone: (result: GeneratedMapping) => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  return fetchEventSource("/api/build-mapping-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: handlers.signal,
    openWhenHidden: true,
    async onopen(res) {
      if (res.ok && res.headers.get("content-type")?.includes("text/event-stream")) return;
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.detail) detail = body.detail;
      } catch {
        /* ignore */
      }
      throw new FatalSseError(detail);
    },
    onmessage(msg) {
      if (!msg.event || !msg.data) return;
      const ev = { event: msg.event, data: JSON.parse(msg.data) } as BuildMappingSseEvent;
      if (ev.event === "conversation") handlers.onConversation(ev.data);
      else if (ev.event === "done") handlers.onDone(ev.data);
      else if (ev.event === "error") handlers.onError(ev.data.message);
    },
    onclose() {
      /* server closed the stream; done/error already delivered */
    },
    onerror(err) {
      const message = err instanceof Error ? err.message : String(err);
      handlers.onError(message);
      throw err; // stop fetch-event-source's auto-retry
    },
  }).catch((err) => {
    if (handlers.signal.aborted) return; // closed the modal, not an error
    if (err instanceof FatalSseError) handlers.onError(err.message);
  });
}

/**
 * Open the translate SSE stream. Calls `onEvent` for each typed event, `onClose`
 * when the stream ends normally, and `onError` for transport/HTTP errors.
 * Pass `signal` from an AbortController to support the Stop button.
 */
export function translateStream(
  req: TranslateRequest,
  handlers: {
    signal: AbortSignal;
    onEvent: (ev: SseEvent) => void;
    onClose: () => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  return fetchEventSource("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: handlers.signal,
    openWhenHidden: true,
    async onopen(res) {
      if (res.ok && res.headers.get("content-type")?.includes("text/event-stream")) return;
      // Non-stream response (e.g. 400 with a JSON detail): surface it and stop.
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.detail) detail = body.detail;
      } catch {
        /* ignore */
      }
      throw new FatalSseError(detail);
    },
    onmessage(msg) {
      if (!msg.event || !msg.data) return;
      const parsed = { event: msg.event, data: JSON.parse(msg.data) } as SseEvent;
      handlers.onEvent(parsed);
    },
    onclose() {
      handlers.onClose();
    },
    onerror(err) {
      // Throw to stop fetch-event-source's automatic retry loop.
      const message = err instanceof Error ? err.message : String(err);
      handlers.onError(message);
      throw err;
    },
  }).catch((err) => {
    if (handlers.signal.aborted) return; // user pressed Stop, not an error
    if (err instanceof FatalSseError) handlers.onError(err.message);
  });
}
