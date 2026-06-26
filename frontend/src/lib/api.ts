// Typed client for the FastAPI backend: small REST helpers (options,
// validate-mapping, detect-features) and the `translate` Server-Sent-Events stream
// that the store consumes. Adds no logic of its own — just fetch + typing.
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { MappingValidity, Options, SseEvent, TranslateRequest } from "@/lib/types";

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

export async function detectFeatures(sql: string): Promise<string[]> {
  const r = await fetch("/api/detect-features", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  if (!r.ok) throw new Error(`/api/detect-features ${r.status}`);
  const data = (await r.json()) as { features: string[] };
  return data.features;
}

class FatalSseError extends Error {}

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
      // Non-stream response (e.g. 400 with a JSON detail) — surface it and stop.
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
    if (handlers.signal.aborted) return; // user pressed Stop — not an error
    if (err instanceof FatalSseError) handlers.onError(err.message);
  });
}
