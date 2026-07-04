# sql2graph-web · frontend

**Vite + React + TypeScript single-page workbench for the SQL -> graph translator, talking to the backend over the `/api` proxy.**

A single-page app that renders the translation workbench and drives the FastAPI
backend over REST plus two Server-Sent-Events streams. No translation logic lives
here; the frontend is pure UI and state. The API base is a hardcoded relative `/api`,
so production must be same-origin (the Vite dev server proxies `/api` to the backend
in development).

For running and building, see the [top-level README](../README.md) and
[`../INSTALL.md`](../INSTALL.md).

## Tech stack

| Concern | Library |
|---|---|
| Framework | React 18 (`react`, `react-dom`) |
| Language | TypeScript 5.5 |
| Build tool | Vite 8 (`vite`, `@vitejs/plugin-react`) |
| Styling | Tailwind CSS 4 (`tailwindcss`, `@tailwindcss/vite`) |
| State | Zustand 4 (`zustand`, with `persist`) |
| Editors | CodeMirror (`@uiw/react-codemirror`, `@codemirror/lang-sql`, `@codemirror/lang-yaml`) |
| SSE client | `@microsoft/fetch-event-source` |
| Graph view | `cytoscape` + `cytoscape-fcose` (draws the schema mapping) |
| Resizable layout | `react-resizable-panels` (the Inputs / Result split) |
| UI primitives | `@radix-ui/react-dialog`, `@radix-ui/react-select` |
| Icons | `lucide-react` |

## Project structure

```
src/
  main.tsx              React entry, mounts <App>
  App.tsx               Workbench layout + app-level effects (store init, dark-mode class, debounced hooks)
  index.css             Tailwind entry + a few globals
  lib/                  Framework-agnostic logic + types
    api.ts              Typed backend client (REST + the translate / build-mapping SSE streams)
    types.ts            Shared domain/API types, mirrored from the backend
  hooks/                State + effects
    useStore.ts                  The Zustand store (state, actions, SSE reducers, persistence)
    useMappingValidation.ts      Debounced validation of the ACTIVE mapping
    useDraftMappingValidation.ts Debounced validation of the DRAFT mapping (build output)
    useFeatureDetection.ts       Debounced SQL feature detection (+ parse_ok)
    useTableCoverage.ts          Debounced table/column coverage pre-flight
  types/
    cytoscape-fcose.d.ts   Ambient types for the fcose layout plugin
  components/
    ui/                 Store-free design-system pieces
      primitives.tsx    Button, Chip, Select, Section, PaneHeader, FooterBar, StatusText…
      CodeEditor.tsx    CodeMirror wrapper (SQL/YAML, theme, Cmd/Ctrl+Enter submit)
      Sidebar.tsx       CollapsibleSidebar rail shell
    Header.tsx          Brand + active-model chip + theme toggle
    WorkspaceBar.tsx    Workspace tab (mapping | sql) + target select + Translate / Stop / Clear
    BuildMappingPanel.tsx   Mapping workspace input: CREATE TABLE DDL + "generate mapping"
    MappingEditorPanel.tsx  Mapping workspace output: the draft-mapping YAML editor + graph
    MappingBody.tsx     Shared mapping view body: the YAML editor paired with the graph
    MappingGraph.tsx        Cytoscape (+ fcose) rendering of the mapping
    MappingGraphLazy.tsx    Lazy wrapper so Cytoscape is code-split out of the initial bundle
    SqlWindowInput.tsx  SQL workspace input: the SQL editor (+ an inner tab for the active mapping)
    OutcomePanel.tsx    SQL workspace output: generated query + run status/outcome footer
    SqlPreflightBanner.tsx  Live pre-flight banner (parse warning / unmapped tables + columns)
    FeatureChips.tsx    Detected-SQL-feature chips
    ChatSidebar.tsx     Live system<->LLM transcript (shared by translate + build)
    ConversationView.tsx    Renders a conversation transcript
    FormatSettingsForm.tsx / LlmSettingsForm.tsx / ValidationSettingsForm.tsx   Settings-sidebar forms
```

The split is **logic vs. visual**: `lib/` + `hooks/` hold `.ts` logic/state;
`components/ui/` holds store-free presentational `.tsx`; the remaining `components/*`
are the store-connected feature components.

## State & data flow

`hooks/useStore.ts` (Zustand) is the **single source of truth**. Components read it
through selectors (`useStore(s => s.…)`); there is no prop-drilling.

- **`form`**: everything the user configures — target, LLM settings, validation
  settings, the SQL, and two mappings: the **active** `mappingYaml` (used for
  translation) and the **draft** `draftMappingYaml` (built from DDL, hand-editable,
  promoted to active via "Use this mapping"). Plus the build inputs `ddl` / `dialect`.
- **`stream`**: the live state of the current translation run (status, latest
  generated query, validation result, iteration counters, token usage, pre-flight
  signals, errors).
- **`build`**: the parallel state of the generate-mapping-from-DDL run.
- **Two top-level workspaces** selected by `view`: `mapping` (DDL input -> mapping
  output) and `sql` (SQL input -> query output). Both live in one resizable
  `PanelGroup`; panes stay mounted and toggle via the `hidden` class so the editors
  and the Cytoscape graph keep their state.

**The run loops.** `translate()` opens the `/api/translate` SSE stream and reduces
each event into `stream`; `buildMapping()` opens `/api/build-mapping-stream` and
reduces into `build`, then writes the generated YAML to `form.draftMappingYaml`. The
translate event lifecycle:

```
status? -> conversation* -> generated -> validated -> (fix | stalled -> validated)* ->
completed | max_iterations | error
```

(plus non-blocking `parse_warning` / `unmapped_tables` / `unmapped_columns`
pre-flight events). `conversation` events feed the Chat sidebar; milestone events
drive the result footer and verdict. `RUNNING_STATUSES` (exported from the store) is
the shared definition of "a run is in flight".

**Debounced side-effects.** Four hooks are wired once in `App.tsx` —
`useMappingValidation`, `useDraftMappingValidation`, `useFeatureDetection`,
`useTableCoverage` — watching the relevant `form` fields and, after the last edit,
calling `/api/validate-mapping`, `/api/detect-features`, and `/api/check-coverage` to
drive the validity footers, the feature chips, and the pre-flight banner.

**Persistence.** Zustand `persist` saves `{ theme, leftOpen, rightOpen, view,
sqlInner, form }` under the key `sql2graph-web`. It is versioned (`version: 4`) with a
`migrate` that carries older persisted shapes forward (e.g. renaming `inputTab` to
`view`, splitting the mapping into active + draft) without dropping the user's `form`.

## Conventions

- **`@/` import alias** -> `src/` (configured in `tsconfig.json` `paths` +
  `vite.config.ts` `resolve.alias`). Import as `@/lib/api`, `@/hooks/useStore`,
  `@/components/ui/primitives`; never deep `../../` paths.
- **Design system** lives in `components/ui/primitives.tsx`. Reuse it — in particular
  `PaneHeader` (fixed `h-9` pane headers), `FooterBar` (the shared `h-9` pane footer),
  and `StatusText` (one icon+color vocabulary for success / error / warn / running /
  muted). New chrome should compose these rather than re-style ad hoc.
- **Dark mode** is class-based: `App.tsx` toggles a `.dark` class on `<html>`;
  components pair every light utility with its `dark:` variant.
- **Layout** is the Inputs / Result split inside one `PanelGroup`; both panes of each
  side stay mounted and toggle via the `hidden` class so CodeMirror and Cytoscape keep
  their state.

## Develop & build

Requires Node.js 22 (Vite 8 needs 20.19+/22.12+).

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api -> http://localhost:8000
npm run build    # tsc --noEmit && vite build -> dist/  (served by the backend in prod / Docker)
```

The dev server needs the backend running on `:8000` for `/api` calls to succeed.
