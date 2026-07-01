// Central Zustand store, the single source of truth for all UI + run state.
// Owns the form, the live translation `stream` state, persistence (with a versioned
// migration), the exported domain constants (RUNNING_STATUSES, SERVER_TYPE_BY_TARGET),
// and the SSE→state reducer inside `translate()`. Components subscribe via selectors.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as api from "@/lib/api";
import type {
  GeneratedMapping,
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

// One label per running status, shared by the result footer (OutcomePanel) and the
// chat sidebar so the two can't drift apart. `currentIteration`/`stalled` refine the
// validating/fixing text; provisioning names the throwaway-DB warmup explicitly.
export function runningLabel(status: Status, opts?: { stalled?: boolean; currentIteration?: number }): string {
  switch (status) {
    case "provisioning":
      return "Setting up throwaway database… (first run can take 10-40s)";
    case "generating":
      return "Generating query…";
    case "validating":
      return `Validating (iteration ${opts?.currentIteration ?? 0})…`;
    default:
      return opts?.stalled ? "Escalating (hotter retry)…" : "Fixing…";
  }
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
  // The ACTIVE mapping used for translation (shown+edited in the SQL window's inner
  // schema-mapping tab; set by "Use this mapping" or by Upload there).
  mappingYaml: string;
  sql: string;
  // "Build mode" inputs: the CREATE TABLE DDL and its dialect, used by
  // buildMapping() to generate a draft mapping. Kept in `form` so they persist
  // alongside sql/mappingYaml.
  ddl: string;
  dialect: string;
  // The DRAFT mapping - the Schema-mapping window's output. Built from DDL and
  // hand-editable; promoted to `mappingYaml` via useThisMapping(). Separate so the
  // builder never disturbs the mapping translation is currently using.
  draftMappingYaml: string;
}

export type BuildStatus = "idle" | "loading" | "done" | "error";

// Transient state for the generate-mapping-from-DDL flow (the ex-modal). Parallels
// `stream`: never persisted, reset per run. `conversation` is the AI naming pass
// that streams into the shared chat sidebar.
interface BuildState {
  status: BuildStatus;
  conversation: Message[];
  result: GeneratedMapping | null;
  errorMessage: string | null;
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
  // library result.status: success | max_iterations_reached | stalled | unmapped_tables | parse_error
  finalStatus: string | null;
  tokenUsage: TokenUsage | null;
  errorMessage: string | null;
  // True while the loop has stalled and is retrying with a fresh, hotter context;
  // transient (lives in `stream`, never persisted). Drives the "escalating" label.
  stalled: boolean;
  // Pre-flight signals for this run: a parse-failure warning (translation still
  // proceeds), the unmapped tables that caused a rejection (LLM skipped), and the
  // unmapped columns (a warning by default, translation still proceeds).
  parseWarning: string | null;
  unmappedTables: string[] | null;
  unmappedColumns: string[] | null;
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
  ddl: "",
  dialect: "generic",
  draftMappingYaml: "",
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
  parseWarning: null,
  unmappedTables: null,
  unmappedColumns: null,
};

const INITIAL_BUILD: BuildState = {
  status: "idle",
  conversation: [],
  result: null,
  errorMessage: null,
};

export const SERVER_TYPE_BY_TARGET: Record<Target, ServerType> = {
  cypher: "neo4j",
  aql: "arangodb",
  gremlin: "gremlin",
};

// Validation modes available per target, sourced from /api/options (which the
// backend derives from the library's valid_modes_for_target; AQL has no
// in-process "syntax" validator). Falls back to the full set before options
// load and against an older backend that doesn't send the per-target map.
export function modesForTarget(options: Options | null, target: Target): ValidationMode[] {
  return options?.validation_modes_by_target?.[target] ?? ["none", "syntax", "server"];
}

// True when a `server`-mode run will fall back to the auto-provisioned throwaway DB:
// the primary connection field for the target's server type is left blank. Shared by
// the request builder, the validation form's hint, and the header chip.
export function usesThrowawayDb(form: FormState): boolean {
  if (form.validation.mode !== "server") return false;
  const s = form.validation.server;
  const primary = SERVER_TYPE_BY_TARGET[form.target] === "neo4j" ? s.uri : s.url;
  return !primary.trim();
}

interface Store {
  options: Options | null;
  theme: "light" | "dark";
  leftOpen: boolean;
  rightOpen: boolean;
  // The active top-level workspace tab: the schema-mapping window (DDL input -> mapping
  // output) or the SQL window (SQL input -> query output). Persisted.
  view: "mapping" | "sql";
  // The SQL window's inner tab: view/edit the active mapping, or the SQL query.
  sqlInner: "mapping" | "sql";
  form: FormState;
  mappingValidity: MappingValidity | null; // validity of the ACTIVE mapping (form.mappingYaml)
  draftValidity: MappingValidity | null; // validity of the DRAFT mapping (form.draftMappingYaml)
  features: string[];
  // Live (as-you-type) pre-flight feedback, independent of a run:
  sqlParseOk: boolean; // false → SQL won't parse; show a "will translate anyway" hint
  coverageUnmapped: string[]; // SQL tables absent from the current mapping
  coverageUnmappedColumns: string[]; // SQL columns of mapped tables the mapping omits
  stream: StreamState;
  abort: AbortController | null;
  // Build-mode ("generate mapping from DDL") run state, mirroring stream/abort.
  build: BuildState;
  buildAbort: AbortController | null;

  init: () => Promise<void>;
  toggleTheme: () => void;
  setLeftOpen: (b: boolean) => void;
  setRightOpen: (b: boolean) => void;
  setView: (v: "mapping" | "sql") => void;
  setSqlInner: (v: "mapping" | "sql") => void;

  setTarget: (t: Target) => void;
  setProvider: (p: Provider) => void;
  setLlm: (patch: Partial<LlmSettings>) => void;
  setValidationMode: (m: ValidationMode) => void;
  setMaxIterations: (n: number | null) => void;
  setServer: (patch: Partial<ServerBag>) => void;
  setMappingYaml: (s: string) => void;
  setSql: (s: string) => void;
  setDdl: (s: string) => void;
  setDialect: (s: string) => void;
  setDraftMappingYaml: (s: string) => void;

  refreshMappingValidity: () => Promise<void>;
  refreshDraftValidity: () => Promise<void>;
  refreshFeatures: () => Promise<void>;
  refreshCoverage: () => Promise<void>;
  translate: () => Promise<void>;
  stop: () => void;
  buildMapping: () => Promise<void>;
  stopBuild: () => void;
  useThisMapping: () => void;
  clearMapping: () => void;
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
// config/models/ollama.yaml via /api/options. Keep the YAML the single source
// of truth. Returns null when the key is absent, which means "let the
// library/Ollama default apply".
function ollamaDefault(options: Options | null, key: string): number | null {
  const v = options?.defaults?.ollama?.[key];
  return typeof v === "number" ? v : null;
}

// The dialect selector's "generic" is a UI sentinel for "no dialect"; the backend
// and library only ever see a real sqlglot dialect name or null. Convert at the edge.
const toDialect = (d: string): string | null => (d === "generic" ? null : d);

function buildRequest(form: FormState): TranslateRequest {
  const { mode, max_iterations, server } = form.validation;
  let server_config = null as TranslateRequest["validation"]["server_config"];
  // A `server`-mode run with a blank primary field falls back to the throwaway DB
  // (server_config stays null); otherwise send the filled connection.
  if (mode === "server" && !usesThrowawayDb(form)) {
    server_config = {
      type: SERVER_TYPE_BY_TARGET[form.target],
      uri: server.uri || null,
      url: server.url || null,
      username: server.username || null,
      password: server.password || null,
      database: server.database || null,
      traversal_source: server.traversal_source || null,
      notifications_min_severity: server.notifications_min_severity || null,
    };
  }
  return {
    target: form.target,
    mapping_yaml: form.mappingYaml,
    sql: form.sql,
    dialect: toDialect(form.dialect),
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
      view: "mapping",
      sqlInner: "sql",
      form: DEFAULT_FORM,
      mappingValidity: null,
      draftValidity: null,
      features: [],
      sqlParseOk: true,
      coverageUnmapped: [],
      coverageUnmappedColumns: [],
      stream: INITIAL_STREAM,
      abort: null,
      build: INITIAL_BUILD,
      buildAbort: null,

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
          // Clamp a persisted mode that isn't valid for the current target.
          const { target, validation } = get().form;
          const allowed = modesForTarget(get().options, target);
          if (!allowed.includes(validation.mode)) get().setValidationMode(allowed[0]);
        } catch (e) {
          console.error("Failed to load options", e);
        }
        if (get().form.mappingYaml.trim()) get().refreshMappingValidity();
        if (get().form.draftMappingYaml.trim()) get().refreshDraftValidity();
      },

      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      setLeftOpen: (b) => set({ leftOpen: b }),
      setRightOpen: (b) => set({ rightOpen: b }),
      setView: (v) => set({ view: v }),
      setSqlInner: (v) => set({ sqlInner: v }),

      setTarget: (t) =>
        set((s) => {
          // Clamp the validation mode to one valid for the new target (e.g. AQL
          // has no "syntax"). Mirrors setProvider resetting the model on change.
          const allowed = modesForTarget(s.options, t);
          const mode = allowed.includes(s.form.validation.mode) ? s.form.validation.mode : allowed[0];
          return { form: { ...s.form, target: t, validation: { ...s.form.validation, mode } } };
        }),
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
      setDdl: (str) => set((s) => ({ form: { ...s.form, ddl: str } })),
      setDialect: (str) => set((s) => ({ form: { ...s.form, dialect: str } })),
      setDraftMappingYaml: (str) => set((s) => ({ form: { ...s.form, draftMappingYaml: str } })),

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

      refreshDraftValidity: async () => {
        const yaml = get().form.draftMappingYaml;
        if (!yaml.trim()) {
          set({ draftValidity: null });
          return;
        }
        try {
          set({ draftValidity: await api.validateMapping(yaml) });
        } catch {
          set({ draftValidity: null });
        }
      },

      refreshFeatures: async () => {
        const { sql, dialect } = get().form;
        if (!sql.trim()) {
          set({ features: [], sqlParseOk: true });
          return;
        }
        try {
          const { features, parse_ok } = await api.detectFeatures(sql, toDialect(dialect));
          set({ features, sqlParseOk: parse_ok });
        } catch {
          /* keep previous */
        }
      },

      refreshCoverage: async () => {
        // Live mirror of the translator's unmapped-tables check: which SQL
        // tables aren't in the current mapping. Needs both SQL and mapping, so
        // it re-runs when either changes (see useTableCoverage). The backend
        // soft-fails (empty list) on unparseable SQL or an invalid mapping.
        const { sql, mappingYaml, dialect } = get().form;
        if (!sql.trim() || !mappingYaml.trim()) {
          set({ coverageUnmapped: [], coverageUnmappedColumns: [] });
          return;
        }
        try {
          const { unmapped_tables, unmapped_columns } = await api.checkCoverage(sql, mappingYaml, toDialect(dialect));
          set({ coverageUnmapped: unmapped_tables, coverageUnmappedColumns: unmapped_columns });
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
          !!s.mappingValidity?.valid &&
          // Reject-level pre-flight signals: don't call translate() for input the
          // library would reject (unmapped tables/columns). The library still
          // rejects programmatically; the UI just avoids the wasted call. Parse
          // failure is a warning, not a reject, so it does not gate.
          s.coverageUnmapped.length === 0 &&
          s.coverageUnmappedColumns.length === 0
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
                case "parse_warning":
                  // Non-blocking: the SQL didn't parse but translation proceeds.
                  st.parseWarning = ev.data.message;
                  break;
                case "unmapped_tables":
                  // The run was rejected before the LLM; `completed` follows.
                  st.unmappedTables = ev.data.tables;
                  break;
                case "unmapped_columns":
                  // Warn by default (translation continues); a reject would
                  // additionally arrive as finalStatus on `completed`.
                  st.unmappedColumns = ev.data.columns;
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
                  st.unmappedTables = r.unmapped_tables ?? st.unmappedTables;
                  // Keep the event-set value if the result's list is empty, so a
                  // warn (default) banner doesn't get cleared on completion.
                  if (r.unmapped_columns && r.unmapped_columns.length > 0) st.unmappedColumns = r.unmapped_columns;
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

      // Generate a mapping from the DDL in `form.ddl`. Mirrors translate(): opens the
      // build-mapping SSE stream, reduces its `conversation` snapshots into the build
      // slice (which feeds the shared chat sidebar), and on completion writes the
      // generated YAML into form.draftMappingYaml (the DRAFT - never the active mapping)
      // so the debounced draft validation refreshes the YAML/Graph view.
      buildMapping: async () => {
        const { form } = get();
        if (!form.ddl.trim() || get().build.status === "loading") return;
        get().buildAbort?.abort();
        const buildAbort = new AbortController();
        set({
          buildAbort,
          build: { ...INITIAL_BUILD, status: "loading" },
        });
        await api.buildMappingStream(
          { ddl: form.ddl, dialect: toDialect(form.dialect), llm: form.llm },
          {
            signal: buildAbort.signal,
            onConversation: (messages) => set((s) => ({ build: { ...s.build, conversation: messages } })),
            onDone: (result) => {
              set((s) => ({ build: { ...s.build, result, status: "done" }, buildAbort: null }));
              get().setDraftMappingYaml(result.mapping_yaml);
              void get().refreshDraftValidity();
            },
            onError: (message) =>
              set((s) => ({ build: { ...s.build, status: "error", errorMessage: message }, buildAbort: null })),
          },
        );
      },

      stopBuild: () => {
        get().buildAbort?.abort();
        set((s) => ({ buildAbort: null, build: { ...s.build, status: s.build.status === "done" ? "done" : "idle" } }));
      },

      // Promote the draft mapping to the ACTIVE mapping used for translation, then jump
      // to the SQL window's schema-mapping tab so it is visible there.
      useThisMapping: () => {
        get().setMappingYaml(get().form.draftMappingYaml);
        void get().refreshMappingValidity();
        set({ view: "sql", sqlInner: "mapping" });
      },

      // Schema-mapping tab's Clear: wipe the DDL, the draft mapping, and the build run.
      // Leaves the active mapping (used for translation) untouched.
      clearMapping: () => {
        get().buildAbort?.abort();
        set((s) => ({
          form: { ...s.form, ddl: "", draftMappingYaml: "" },
          build: INITIAL_BUILD,
          buildAbort: null,
          draftValidity: null,
        }));
      },

      // SQL tab's Clear: wipe the SQL query and the last run outcome. Leaves the active
      // mapping and the draft untouched.
      clearWorkspace: () =>
        set((s) => ({
          form: { ...s.form, sql: "" },
          stream: INITIAL_STREAM,
          features: [],
          sqlParseOk: true,
          coverageUnmapped: [],
          coverageUnmappedColumns: [],
        })),
    }),
    {
      name: "sql2graph-web",
      version: 4,
      // v0 persisted a `mappingOpen` flag (the schema-mapping drawer) - dropped.
      // v2 added `form.ddl`/`form.dialect` (the build inputs) - backfilled so a
      // rehydrated older `form` isn't missing keys.
      // v3 renamed the persisted `inputTab` to the top-level `view` (the workspace
      // tab) and removed the short-lived `centerMode`; carry the old value over.
      // v4 split the mapping into active (`form.mappingYaml`) + `form.draftMappingYaml`
      // and added the SQL window's inner tab `sqlInner`; backfill both.
      migrate: (persisted: unknown) => {
        const s = { ...((persisted as Record<string, unknown>) ?? {}) };
        delete s.mappingOpen;
        delete s.centerMode;
        if (s.inputTab && s.view === undefined) s.view = s.inputTab;
        delete s.inputTab;
        if (s.sqlInner === undefined) s.sqlInner = "sql";
        if (s.form && typeof s.form === "object") {
          s.form = { ddl: "", dialect: "generic", draftMappingYaml: "", ...(s.form as Record<string, unknown>) };
        }
        return s as unknown as Store;
      },
      partialize: (s) => ({
        theme: s.theme,
        leftOpen: s.leftOpen,
        rightOpen: s.rightOpen,
        view: s.view,
        sqlInner: s.sqlInner,
        form: s.form,
      }),
    },
  ),
);
