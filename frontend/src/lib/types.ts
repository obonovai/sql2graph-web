// Shared domain + API types, mirrored from the backend's Pydantic models
// (backend/app/models.py) and the translate SSE event shapes (backend/app/bridge.py).
// Keep these in sync with the backend when either side changes.
export type Provider = "ollama" | "anthropic";
export type Target = "cypher" | "aql" | "gremlin";
export type ValidationMode = "none" | "syntax" | "server";
export type ServerType = "neo4j" | "arangodb" | "gremlin";
export type Role = "system" | "user" | "assistant";

export interface LlmSettings {
  provider: Provider;
  model: string;
  temperature: number;
  max_retries: number;
  num_ctx?: number | null; // ollama
  host?: string | null; // ollama (else OLLAMA_HOST on backend)
  repeat_penalty?: number | null; // ollama (>1.0 curbs repeat loops)
  max_output_tokens?: number | null; // anthropic
}

export interface ServerSettings {
  type: ServerType;
  uri?: string | null;
  database?: string | null;
  notifications_min_severity?: "OFF" | "INFORMATION" | "WARNING" | null;
  url?: string | null;
  traversal_source?: string | null;
  username?: string | null;
  password?: string | null;
}

export interface ValidationSettings {
  mode: ValidationMode;
  max_iterations: number;
  server_config?: ServerSettings | null;
}

export interface TranslateRequest {
  target: Target;
  mapping_yaml: string;
  sql: string;
  llm: LlmSettings;
  validation: ValidationSettings;
}

export interface Message {
  role: Role;
  content: string;
}

export interface TokenUsage {
  input_tokens: number; // uncached prompt tokens
  output_tokens: number; // generated tokens
  cache_read_tokens: number; // Anthropic prompt-cache hits (0 on Ollama)
  cache_creation_tokens: number; // Anthropic cache writes (0 on Ollama)
  total_tokens: number; // computed = sum of the four
}

export interface TranslationResult {
  sql_query: string;
  generated_query: string | null;
  target_language: Target;
  validation_passed: boolean;
  validation_errors: string[];
  iterations_used: number;
  // "success" | "max_iterations_reached" | "stalled" | "unmapped_tables" | "unmapped_columns" | "parse_error"
  status: string;
  // Source tables absent from the schema mapping; populated when status === "unmapped_tables".
  unmapped_tables?: string[];
  // "table.column" refs of mapped tables the mapping doesn't define; set on the
  // unmapped-columns signal (warn or reject).
  unmapped_columns?: string[];
  duration_seconds: number;
  // Optional so the UI degrades gracefully if the editable library predates the feature.
  token_usage?: TokenUsage;
}

export interface MappingValidity {
  valid: boolean;
  errors: string[];
  node_count: number;
  edge_count: number;
}

export interface Options {
  providers: Provider[];
  targets: Target[];
  validation_modes: ValidationMode[];
  validation_modes_by_target: Record<Target, ValidationMode[]>;
  defaults: {
    anthropic: Record<string, unknown>;
    ollama: Record<string, unknown>;
    max_iterations: number;
  };
  server_defaults: Record<ServerType, Record<string, unknown>>;
  target_server_type: Record<Target, ServerType>;
  notifications_min_severity_options: string[];
  docker_available: boolean;
}

// SSE event payloads (discriminated by the SSE `event` name).
export type SseEvent =
  | { event: "status"; data: { phase: string } }
  | { event: "conversation"; data: Message[] }
  | { event: "parse_warning"; data: { message: string } }
  | { event: "unmapped_tables"; data: { tables: string[]; message: string } }
  | { event: "unmapped_columns"; data: { columns: string[]; message: string } }
  | { event: "generated"; data: { iteration: number; query: string } }
  | { event: "validated"; data: { iteration: number; query: string; errors: string[]; passed: boolean } }
  | { event: "fix"; data: { iteration: number; query: string } }
  | { event: "stalled"; data: { iteration: number; query: string; errors: string[] } }
  | { event: "max_iterations"; data: { iteration: number; errors: string[] } }
  | { event: "completed"; data: { result: TranslationResult } }
  | { event: "error"; data: { message: string } };

// /api/detect-features response.
export interface FeatureDetection {
  features: string[];
  parse_ok: boolean;
}

// /api/check-coverage response.
export interface CoverageCheck {
  unmapped_tables: string[];
  unmapped_columns: string[];
  parse_ok: boolean;
}
