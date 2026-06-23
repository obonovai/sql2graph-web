import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as api from "./api";
import type {
  LlmSettings,
  MappingValidity,
  Message,
  Options,
  Preset,
  Provider,
  ServerType,
  Target,
  TokenUsage,
  TranslateRequest,
  ValidationMode,
} from "./types";

export type Status = "idle" | "provisioning" | "generating" | "validating" | "fixing" | "done" | "error";

export interface IterationChip {
  kind: "validated" | "fix" | "max";
  iteration: number;
  passed?: boolean;
  errorCount?: number;
}

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
  tokenUsage: TokenUsage | null;
  errorMessage: string | null;
  chips: IterationChip[];
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
    num_ctx: 8192,
    host: "",
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
  tokenUsage: null,
  errorMessage: null,
  chips: [],
};

export const SERVER_TYPE_BY_TARGET: Record<Target, ServerType> = {
  cypher: "neo4j",
  aql: "arangodb",
  gremlin: "gremlin",
};

interface Store {
  options: Options | null;
  presets: Preset[];
  theme: "light" | "dark";
  leftOpen: boolean;
  rightOpen: boolean;
  mappingOpen: boolean;
  form: FormState;
  mappingValidity: MappingValidity | null;
  features: string[];
  stream: StreamState;
  abort: AbortController | null;

  init: () => Promise<void>;
  toggleTheme: () => void;
  setLeftOpen: (b: boolean) => void;
  setRightOpen: (b: boolean) => void;
  setMappingOpen: (b: boolean) => void;

  setTarget: (t: Target) => void;
  setProvider: (p: Provider) => void;
  setLlm: (patch: Partial<LlmSettings>) => void;
  setValidationMode: (m: ValidationMode) => void;
  setMaxIterations: (n: number | null) => void;
  setServer: (patch: Partial<ServerBag>) => void;
  setMappingYaml: (s: string) => void;
  setSql: (s: string) => void;
  applyPreset: (name: string) => void;

  refreshMappingValidity: () => Promise<void>;
  refreshFeatures: () => Promise<void>;
  translate: () => Promise<void>;
  stop: () => void;
  clearWorkspace: () => void;
  resetAll: () => void;
  canTranslate: () => boolean;
}

// The model default comes from the library's example config (via /api/options),
// not a hardcoded value here.
function modelDefault(options: Options | null, provider: Provider): string {
  const m = options?.defaults?.[provider]?.model;
  return typeof m === "string" ? m : "";
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
      max_output_tokens: form.llm.max_output_tokens || null,
    },
    validation: { mode, max_iterations: max_iterations || 3, server_config },
  };
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      options: null,
      presets: [],
      theme: "light",
      leftOpen: true,
      rightOpen: true,
      mappingOpen: true,
      form: DEFAULT_FORM,
      mappingValidity: null,
      features: [],
      stream: INITIAL_STREAM,
      abort: null,

      init: async () => {
        try {
          const [options, presets] = await Promise.all([api.getOptions(), api.getPresets()]);
          set({ options, presets });
          // Seed the model from the library config for new/cleared users; leave a
          // user's customized (non-empty) model untouched.
          if (!get().form.llm.model) {
            get().setLlm({ model: modelDefault(options, get().form.llm.provider) });
          }
        } catch (e) {
          console.error("Failed to load options/presets", e);
        }
        if (get().form.mappingYaml.trim()) get().refreshMappingValidity();
      },

      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      setLeftOpen: (b) => set({ leftOpen: b }),
      setRightOpen: (b) => set({ rightOpen: b }),
      setMappingOpen: (b) => set({ mappingOpen: b }),

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

      applyPreset: (name) => {
        const preset = get().presets.find((p) => p.name === name);
        if (!preset) return;
        set((s) => ({ form: { ...s.form, mappingYaml: preset.mapping_yaml, sql: preset.sample_sql } }));
        get().refreshMappingValidity();
        get().refreshFeatures();
      },

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
                  break;
                case "validated":
                  st.currentIteration = ev.data.iteration;
                  st.validationErrors = ev.data.errors;
                  st.validationPassed = ev.data.passed;
                  st.chips = [
                    ...st.chips,
                    {
                      kind: "validated",
                      iteration: ev.data.iteration,
                      passed: ev.data.passed,
                      errorCount: ev.data.errors.length,
                    },
                  ];
                  if (!ev.data.passed) st.status = "fixing";
                  break;
                case "fix":
                  st.generatedQuery = ev.data.query;
                  st.currentIteration = ev.data.iteration + 1;
                  st.chips = [...st.chips, { kind: "fix", iteration: ev.data.iteration }];
                  st.status = "validating";
                  break;
                case "max_iterations":
                  st.validationErrors = ev.data.errors;
                  st.chips = [...st.chips, { kind: "max", iteration: ev.data.iteration }];
                  break;
                case "completed": {
                  const r = ev.data.result;
                  st.generatedQuery = r.generated_query;
                  st.validationErrors = r.validation_errors;
                  st.validationPassed = r.validation_passed;
                  st.durationSeconds = r.duration_seconds;
                  st.iterationsUsed = r.iterations_used;
                  st.tokenUsage = r.token_usage ?? null;
                  st.status = "done";
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

      resetAll: () =>
        set((s) => ({
          form: {
            ...DEFAULT_FORM,
            llm: { ...DEFAULT_FORM.llm, model: modelDefault(s.options, DEFAULT_FORM.llm.provider) },
            validation: { ...DEFAULT_FORM.validation, server: { ...EMPTY_SERVER } },
          },
          stream: INITIAL_STREAM,
          features: [],
          mappingValidity: null,
        })),
    }),
    {
      name: "rows2graph-web",
      partialize: (s) => ({
        theme: s.theme,
        leftOpen: s.leftOpen,
        rightOpen: s.rightOpen,
        mappingOpen: s.mappingOpen,
        form: s.form,
      }),
    },
  ),
);
