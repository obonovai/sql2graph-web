# Frontend structure and conventions

**The layout, per-file map, and coding conventions of the React SPA in
`frontend/src`: pure UI and state, no translation logic.**

## Scope

This page owns: the tech stack, the source tree, the two-workspace layout
model, and the conventions to follow when touching the UI. Related topics live
with their owners:

- [state.md](state.md): the frontend state model, the Zustand store.
- [install.md](install.md): develop and build commands, environment.
- [architecture.md](architecture.md): the big picture and the anatomy of a
  translate run.
- [README.md](README.md): the full doc map.

---

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

---

## Source layout

```
frontend/src/
  main.tsx              React entry, mounts <App>
  App.tsx               Workbench layout + app-level effects (store init, dark-mode class, debounced hooks)
  index.css             Tailwind entry + a few globals
  lib/                  Framework-agnostic logic + types
    api.ts              Typed backend client (REST + the translate / build-mapping SSE streams)
    diff.ts             Mapping-diff helpers: derive the names the AI renamed, to highlight in the YAML editor + graph
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
    WorkspaceBar.tsx    Workspace tabs (Build mapping | Translate SQL) + contextual actions (Generate or Translate / Stop / Clear); the target select lives in the Formats settings form
    BuildMappingPanel.tsx   Mapping workspace input: the CREATE TABLE DDL editor (Cmd/Ctrl+Enter triggers Generate; the button lives in the workspace bar)
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

The split is **logic vs. visual**: `lib/` + `hooks/` hold `.ts` logic and
state; `components/ui/` holds store-free presentational `.tsx`; the remaining
`components/*` are the store-connected feature components.

---

## The two workspaces

The top-level `view` field selects one of two workspaces
(`frontend/src/hooks/useStore.ts:205`), each an input pane on the left and an
output pane on the right of one shared resizable `PanelGroup`
(`frontend/src/App.tsx:81-103`):

| `view` | Left pane (input) | Right pane (output) |
|---|---|---|
| `mapping` | `BuildMappingPanel`: `CREATE TABLE` DDL | `MappingEditorPanel`: the draft mapping, YAML editor or graph |
| `sql` | `SqlWindowInput`: the SQL editor | `OutcomePanel`: generated query + verdict footer |

The SQL window's input pane carries its own inner tab strip, `sqlInner`
(`frontend/src/hooks/useStore.ts:206-207`): one tab for the SQL query, one for
the **active** schema mapping, so what translation will actually use can be
viewed, edited, or replaced without leaving the SQL window
(`frontend/src/components/SqlWindowInput.tsx:10-13`). "Use this mapping"
promotes the draft to active and jumps straight to that tab
(`useThisMapping`, `frontend/src/hooks/useStore.ts:609-613`). The active/draft
mapping distinction itself belongs to the store; see [state.md](state.md).

**Hidden, not unmounted.** Each `Panel` holds both of its possible panes at
once; switching workspaces toggles the `hidden` class rather than unmounting
(`frontend/src/App.tsx:86-102`). CodeMirror editors and the Cytoscape graph
therefore keep their state (content, undo history, layout) across tab
switches, and because the divider is one shared `PanelGroup`, its position
persists too. The same pattern repeats one level down: `MappingBody` keeps the
YAML editor mounted underneath the Graph view
(`frontend/src/components/MappingBody.tsx:46-48`).

---

## Conventions

- **`@/` import alias.** `@/` resolves to `src/` (`frontend/tsconfig.json:20`,
  `frontend/vite.config.ts:11`). Import as `@/lib/api`, `@/hooks/useStore`,
  `@/components/ui/primitives`; never deep `../../` paths.
- **Design-system primitives** live in `components/ui/primitives.tsx`. Reuse
  them before adding new ones, in particular `PaneHeader` (the fixed `h-9`
  pane header, `frontend/src/components/ui/primitives.tsx:271`), `FooterBar`
  (the shared `h-9` pane footer,
  `frontend/src/components/ui/primitives.tsx:443`), and `StatusText` (one
  icon-and-color vocabulary for success / error / warn / running / muted,
  `frontend/src/components/ui/primitives.tsx:456`). New chrome should compose
  these rather than restyle ad hoc.
- **Dark mode** is class-based, not OS-preference-based: `App.tsx` toggles a
  `.dark` class on `<html>` from the persisted theme
  (`frontend/src/App.tsx:52-54`), and the Tailwind `@custom-variant dark` in
  `frontend/src/index.css:4` keys every `dark:` utility off that class.
  Components pair every light utility with its `dark:` variant.
- **Layout switches by visibility, not by mounting.** Panes toggle the
  `hidden` class instead of unmounting (see the two workspaces above); a new
  pane should follow the same pattern so stateful widgets (CodeMirror,
  Cytoscape) survive tab switches.
