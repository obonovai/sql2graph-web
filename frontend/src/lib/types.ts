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
  dialect?: string | null;
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

// Structured node/edge view of a mapping (mirrors the library's SchemaMapping
// model_dump), so the UI can draw the graph without parsing YAML.
export interface GraphNode {
  label: string; // node label (also its unique id; edges reference it)
  source_table: string;
  primary_key: string | string[]; // one or more columns (composite key); mirrors the library's model_dump
  properties: Record<string, string>; // graph property name -> SQL column
  // graph property name -> semantic type (date/datetime/integer/...). Optional and
  // sparse: only typed properties appear. Optional so payloads from an editable
  // library that predates typed properties still typecheck.
  property_types?: Record<string, string>;
}

export interface GraphEdge {
  type: string;
  source_node: string; // a GraphNode.label
  target_node: string; // a GraphNode.label
  source_table: string;
  source_foreign_key: string | string[]; // one or more columns; positionally matched to target_primary_key
  target_primary_key: string | string[];
  properties: Record<string, string>;
  property_types?: Record<string, string>; // same as GraphNode.property_types
}

export interface MappingGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface MappingValidity {
  valid: boolean;
  errors: string[];
  node_count: number;
  edge_count: number;
  graph: MappingGraph | null; // structured graph when valid, else null
}

// /api/build-mapping coverage report (mirrors CoverageReport.as_dict()).
export interface CoverageReport {
  node_tables: string[];
  edge_tables: string[]; // junction tables collapsed to edges
  fk_edges: string[];
  dropped_objects: { name: string; reason: string }[];
  synthesized_keys: string[];
  warnings: string[];
  node_count: number;
  edge_count: number;
}

// /api/build-mapping-stream SSE events: conversation snapshots, then a final `done`
// with the full result, or `error`.
export type BuildMappingSseEvent =
  | { event: "conversation"; data: Message[] }
  | { event: "done"; data: GeneratedMapping }
  | { event: "error"; data: { message: string } };

// One graph-facing name the AI refinement renamed (mirrors the library's RenameDiff).
export interface RenameDiff {
  kind: string; // "node label" | "edge type" | "property"
  where: string; // context: source table, join column, or "Label.column"
  before: string; // the deterministic name
  after: string; // the AI's name
}

// All renames between the deterministic skeleton and its refined version (mirrors
// the library's MappingDiff). Only names change; SQL identifiers/structure never do.
export interface MappingDiff {
  label_renames: RenameDiff[];
  edge_type_renames: RenameDiff[];
  property_renames: RenameDiff[];
}

// /api/build-mapping-stream `done` payload. The structure is always derived
// deterministically; the LLM naming pass runs only when the request asks to refine.
export interface GeneratedMapping {
  mapping_yaml: string; // the mapping (AI-refined when refined===true, else deterministic)
  graph: MappingGraph; // structured view of mapping_yaml (for the Graph toggle)
  skeleton_yaml: string; // the deterministic draft before refinement (the "Original")
  skeleton_graph: MappingGraph; // structured view of skeleton_yaml
  diff: MappingDiff | null; // the renames the AI applied; null when refinement was skipped
  report: CoverageReport;
  warnings: string[];
  refined: boolean; // true iff the AI changed the deterministic draft
  conversation: Message[]; // the AI naming chat (empty when refinement was skipped)
  duration_seconds: number; // wall-clock of the naming pass (0 for a deterministic build)
  token_usage: TokenUsage; // tokens the naming pass consumed (all-zero when skipped)
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
