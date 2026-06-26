// Central Zustand store — the single source of truth for all UI + run state.
// Owns the form, the live translation `stream` state, persistence (with a versioned
// migration), the exported domain constants (RUNNING_STATUSES, SERVER_TYPE_BY_TARGET),
// and the SSE→state reducer inside `translate()`. Components subscribe via selectors.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as api from "@/lib/api";
import type {
  LlmSettings,
  MappingValidity,
  Message,
  Options,
  Provider,
  ServerType,
  Target,
  TokenUsage,
  TranslateRequest,
  ValidationMode,
} from "@/lib/types";

export type Status = "idle" | "provisioning" | "generating" | "validating" | "fixing" | "done" | "error";

// Statuses during which a run is actively in flight. Exported so the chrome
// components (run-setup bar, result footer, chat rail) share one definition
// instead of each re-declaring the set.
export const RUNNING_STATUSES = new Set<Status>(["generating", "validating", "fixing", "provisioning"]);

// A generic bag of every possible server-config field; the relevant subset is
// picked per target at request-build time.
export interface ServerBag {
  uri: string;
  url: string;
  username: string;
  password: string;
  database: string;
  traversal_source: string;
  notifications_min_severity: "OFF" | "INFORMATION" | "WARNING" | "";
}

export interface FormState {
  target: Target;
  llm: LlmSettings;
  validation: { mode: ValidationMode; max_iterations: number | null; server: ServerBag };
  mappingYaml: string;
  sql: string;
}

interface StreamState {
  status: Status;
  currentIteration: number;
  conversation: Message[];
  generatedQuery: string | null;
  validationErrors: string[];
  validationPassed: boolean | null;
  durationSeconds: number | null;
  iterationsUsed: number | null;
  finalStatus: string | null; // library result.status: success | max_iterations_reached | stalled
  tokenUsage: TokenUsage | null;
  errorMessage: string | null;
  // True while the loop has stalled and is retrying with a fresh, hotter context;
  // transient (lives in `stream`, never persisted). Drives the "escalating" label.
  stalled: boolean;
}

const EMPTY_SERVER: ServerBag = {
  uri: "",
  url: "",
  username: "",
  password: "",
  database: "",
  traversal_source: "",
  notifications_min_severity: "",
};

const DEFAULT_FORM: FormState = {
  target: "cypher",
  llm: {
    provider: "anthropic",
    model: "", // seeded from the library config via /api/options (see modelDefault)
    temperature: 0.1,
    max_retries: 3,
    num_ctx: 16384,
    host: "",
    repeat_penalty: null, // seeded from /api/options (config/models/ollama.yaml)
    max_output_tokens: 4096,
  },
  validation: { mode: "syntax", max_iterations: 3, server: { ...EMPTY_SERVER } },
  mappingYaml: "",
  sql: "",
};

const INITIAL_STREAM: StreamState = {
  status: "idle",
  currentIteration: 0,
  conversation: [],
  generatedQuery: null,
  validationErrors: [],
  validationPassed: null,
  durationSeconds: null,
  iterationsUsed: null,
  finalStatus: null,
  tokenUsage: null,
  errorMessage: null,
  stalled: false,
};

export const SERVER_TYPE_BY_TARGET: Record<Target, ServerType> = {
  cypher: "neo4j",
  aql: "arangodb",
  gremlin: "gremlin",
};

interface Store {
  options: Options | null;
  theme: "light" | "dark";
  leftOpen: boolean;
  rightOpen: boolean;
  inputTab: "mapping" | "sql";
  form: FormState;
  mappingValidity: MappingValidity | null;
  features: string[];
  stream: StreamState;
  abort: AbortController | null;

  init: () => Promise<void>;
  toggleTheme: () => void;
  setLeftOpen: (b: boolean) => void;
  setRightOpen: (b: boolean) => void;
  setInputTab: (t: "mapping" | "sql") => void;

  setTarget: (t: Target) => void;
  setProvider: (p: Provider) => void;
  setLlm: (patch: Partial<LlmSettings>) => void;
  setValidationMode: (m: ValidationMode) => void;
  setMaxIterations: (n: number | null) => void;
  setServer: (patch: Partial<ServerBag>) => void;
  setMappingYaml: (s: string) => void;
  setSql: (s: string) => void;

  refreshMappingValidity: () => Promise<void>;
  refreshFeatures: () => Promise<void>;
  translate: () => Promise<void>;
  stop: () => void;
  clearWorkspace: () => void;
  canTranslate: () => boolean;
}

// The model default comes from the library's example config (via /api/options),
// not a hardcoded value here.
function modelDefault(options: Options | null, provider: Provider): string {
  const m = options?.defaults?.[provider]?.model;
  return typeof m === "string" ? m : "";
}

// Numeric Ollama defaults (num_ctx, repeat_penalty) likewise come from
// config/models/ollama.yaml via /api/options — keep the YAML the single source
// of truth. Returns null when the key is absent, which means "let the
// library/Ollama default apply".
function ollamaDefault(options: Options | null, key: string): number | null {
  const v = options?.defaults?.ollama?.[key];
  return typeof v === "number" ? v : null;
}

function buildRequest(form: FormState): TranslateRequest {
  const { mode, max_iterations, server } = form.validation;
  let server_config = null as TranslateRequest["validation"]["server_config"];
  if (mode === "server") {
    const type = SERVER_TYPE_BY_TARGET[form.target];
    const primary = type === "neo4j" ? server.uri : server.url;
    if (primary.trim()) {
      server_config = {
        type,
        uri: server.uri || null,
        url: server.url || null,
        username: server.username || null,
        password: server.password || null,
        database: server.database || null,
        traversal_source: server.traversal_source || null,
        notifications_min_severity: server.notifications_min_severity || null,
      };
    }
  }
  return {
    target: form.target,
    mapping_yaml: form.mappingYaml,
    sql: form.sql,
    llm: {
      ...form.llm,
      host: form.llm.host || null,
      // An emptied-then-blurred field becomes 0; treat 0 as "use the library default".
      num_ctx: form.llm.num_ctx || null,
      repeat_penalty: form.llm.repeat_penalty || null,
      max_output_tokens: form.llm.max_output_tokens || null,
    },
    validation: { mode, max_iterations: max_iterations || 3, server_config },
  };
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      options: null,
      theme: "light",
      leftOpen: true,
      rightOpen: true,
      inputTab: "mapping",
      form: DEFAULT_FORM,
      mappingValidity: null,
      features: [],
      stream: INITIAL_STREAM,
      abort: null,

      init: async () => {
        try {
          const options = await api.getOptions();
          set({ options });
          // Seed defaults from the library config for new/cleared users, leaving
          // any customized (already-set) value untouched. Model is seeded for the
          // current provider; the Ollama numeric knobs are seeded from the YAML so
          // config/models/ollama.yaml stays the single source of truth.
          const llm = get().form.llm;
          const patch: Partial<LlmSettings> = {};
          if (!llm.model) patch.model = modelDefault(options, llm.provider);
          if (llm.repeat_penalty == null) patch.repeat_penalty = ollamaDefault(options, "repeat_penalty");
          if (llm.num_ctx == null) patch.num_ctx = ollamaDefault(options, "num_ctx");
          if (Object.keys(patch).length > 0) get().setLlm(patch);
        } catch (e) {
          console.error("Failed to load options", e);
        }
        if (get().form.mappingYaml.trim()) get().refreshMappingValidity();
      },

      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      setLeftOpen: (b) => set({ leftOpen: b }),
      setRightOpen: (b) => set({ rightOpen: b }),
      setInputTab: (t) => set({ inputTab: t }),

      setTarget: (t) => set((s) => ({ form: { ...s.form, target: t } })),
      setProvider: (p) =>
        set((s) => ({ form: { ...s.form, llm: { ...s.form.llm, provider: p, model: modelDefault(s.options, p) } } })),
      setLlm: (patch) => set((s) => ({ form: { ...s.form, llm: { ...s.form.llm, ...patch } } })),
      setValidationMode: (m) => set((s) => ({ form: { ...s.form, validation: { ...s.form.validation, mode: m } } })),
      setMaxIterations: (n) =>
        set((s) => ({ form: { ...s.form, validation: { ...s.form.validation, max_iterations: n } } })),
      setServer: (patch) =>
        set((s) => ({
          form: { ...s.form, validation: { ...s.form.validation, server: { ...s.form.validation.server, ...patch } } },
        })),
      setMappingYaml: (str) => set((s) => ({ form: { ...s.form, mappingYaml: str } })),
      setSql: (str) => set((s) => ({ form: { ...s.form, sql: str } })),

      refreshMappingValidity: async () => {
        const yaml = get().form.mappingYaml;
        if (!yaml.trim()) {
          set({ mappingValidity: null });
          return;
        }
        try {
          set({ mappingValidity: await api.validateMapping(yaml) });
        } catch {
          set({ mappingValidity: null });
        }
      },

      refreshFeatures: async () => {
        const sql = get().form.sql;
        if (!sql.trim()) {
          set({ features: [] });
          return;
        }
        try {
          set({ features: await api.detectFeatures(sql) });
        } catch {
          /* keep previous */
        }
      },

      canTranslate: () => {
        const s = get();
        return (
          s.stream.status !== "generating" &&
          s.stream.status !== "validating" &&
          s.stream.status !== "fixing" &&
          s.stream.status !== "provisioning" &&
          !!s.form.sql.trim() &&
          !!s.mappingValidity?.valid
        );
      },

      translate: async () => {
        const { form } = get();
        if (!get().canTranslate()) return;
        const abort = new AbortController();
        set({
          abort,
          stream: { ...INITIAL_STREAM, status: "generating" },
        });
        const req = buildRequest(form);
        await api.translateStream(req, {
          signal: abort.signal,
          onEvent: (ev) => {
            set((s) => {
              const st = { ...s.stream };
              // Reduce one SSE event into stream state. Lifecycle per run:
              // status? → conversation* → generated → validated → (fix | stalled →
              // validated)* → completed | max_iterations | error.
              switch (ev.event) {
                case "status":
                  if (ev.data.phase === "provisioning") st.status = "provisioning";
                  break;
                case "conversation":
                  st.conversation = ev.data;
                  if (st.status === "provisioning" || st.status === "idle") st.status = "generating";
                  break;
                case "generated":
                  st.currentIteration = ev.data.iteration;
                  st.generatedQuery = ev.data.query;
                  st.status = "validating";
                  st.stalled = false;
                  break;
                case "validated":
                  st.currentIteration = ev.data.iteration;
                  st.validationErrors = ev.data.errors;
                  st.validationPassed = ev.data.passed;
                  st.stalled = false;
                  if (!ev.data.passed) st.status = "fixing";
                  break;
                case "fix":
                  st.generatedQuery = ev.data.query;
                  st.currentIteration = ev.data.iteration + 1;
                  st.status = "validating";
                  break;
                case "stalled":
                  // The loop made no progress and is escalating with a fresh,
                  // hotter retry. Keep showing activity (a fix is in flight).
                  st.validationErrors = ev.data.errors;
                  st.status = "fixing";
                  st.stalled = true;
                  break;
                case "max_iterations":
                  st.validationErrors = ev.data.errors;
                  break;
                case "completed": {
                  const r = ev.data.result;
                  st.generatedQuery = r.generated_query;
                  st.validationErrors = r.validation_errors;
                  st.validationPassed = r.validation_passed;
                  st.durationSeconds = r.duration_seconds;
                  st.iterationsUsed = r.iterations_used;
                  st.finalStatus = r.status;
                  st.tokenUsage = r.token_usage ?? null;
                  st.status = "done";
                  st.stalled = false;
                  break;
                }
                case "error":
                  st.status = "error";
                  st.errorMessage = ev.data.message;
                  break;
              }
              return { stream: st };
            });
          },
          onClose: () => {
            set((s) =>
              s.stream.status === "done" || s.stream.status === "error"
                ? {}
                : { stream: { ...s.stream, status: "done" } },
            );
            set({ abort: null });
          },
          onError: (message) => set((s) => ({ stream: { ...s.stream, status: "error", errorMessage: message }, abort: null })),
        });
      },

      stop: () => {
        get().abort?.abort();
        set((s) => ({ abort: null, stream: { ...s.stream, status: s.stream.status === "done" ? "done" : "idle" } }));
      },

      clearWorkspace: () =>
        set((s) => ({ form: { ...s.form, sql: "" }, stream: INITIAL_STREAM, features: [] })),
    }),
    {
      name: "rows2graph-web",
      version: 1,
      // v0 persisted a `mappingOpen` flag (the schema-mapping drawer). The drawer
      // is gone — mapping is now an input tab (`inputTab`) — so drop the stale key
      // while preserving the user's saved `form` (SQL + mapping). `inputTab` is
      // absent from old storage and falls back to its initial value.
      migrate: (persisted: unknown) => {
        const s = { ...((persisted as Record<string, unknown>) ?? {}) };
        delete s.mappingOpen;
        return s as unknown as Store;
      },
      partialize: (s) => ({
        theme: s.theme,
        leftOpen: s.leftOpen,
        rightOpen: s.rightOpen,
        inputTab: s.inputTab,
        form: s.form,
      }),
    },
  ),
);
