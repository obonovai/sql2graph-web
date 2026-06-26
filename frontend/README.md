# rows2graph-web · frontend

A Vite + React + TypeScript single-page app. It talks to the FastAPI backend over
the `/api` proxy (REST + a Server-Sent-Events stream) and renders the SQL → graph
translation workbench. No translation logic lives here — the frontend is pure UI +
state.

For running/building and the backend, see the [top-level README](../README.md).

## Project structure

```
src/
  main.tsx              React entry — mounts <App>
  App.tsx               Workbench layout + app-level effects
  index.css             Tailwind entry + a few globals
  lib/                  Framework-agnostic logic + types
    api.ts              Typed backend client (REST + the translate SSE stream)
    types.ts            Shared domain/API types, mirrored from the backend
  hooks/                State + effects
    useStore.ts         The Zustand store (all state, actions, SSE reducer, persistence)
    useMappingValidation.ts   Debounced live mapping-YAML validation
    useFeatureDetection.ts    Debounced SQL feature detection
  components/
    ui/                 Pure, store-free design-system pieces
      primitives.tsx    Button, Chip, Select, inputs, PaneHeader, FooterBar, StatusText…
      CodeEditor.tsx    CodeMirror wrapper (SQL/YAML, theme, Cmd/Ctrl+Enter submit)
      Sidebar.tsx       CollapsibleSidebar rail shell
    Header.tsx          Brand + active-model chip + theme toggle
    RunSetupBar.tsx     Target select + Translate / Stop / Clear
    InputsPanel.tsx     Mapping | SQL tabbed editors (+ upload, validity footer)
    OutcomePanel.tsx    Result header + generated query + status/outcome footer
    ChatSidebar.tsx     Live system↔LLM transcript
    FeatureChips.tsx    Detected-SQL-feature footer (SQL tab)
    LlmSettingsForm.tsx / ValidationSettingsForm.tsx   Settings-sidebar forms
```

The split is **logic vs. visual**: `lib/` + `hooks/` hold `.ts` logic/state;
`components/ui/` holds store-free presentational `.tsx`; `components/*` are the
store-connected feature components.

## State & data flow

`hooks/useStore.ts` (Zustand) is the **single source of truth**. Components read it
through selectors (`useStore(s => s.…)`); there is no prop-drilling.

- **`form`** — everything the user configures (target, LLM settings, validation
  settings, mapping YAML, SQL). Persisted to `localStorage` (see below).
- **`stream`** — the live state of the current translation run (status, the latest
  generated query, validation result, iteration counters, token usage, errors).
- **Actions** — `init()` (load `/api/options`), the `setX` setters, the debounced
  `refreshMappingValidity()` / `refreshFeatures()`, and `translate()` / `stop()` /
  `clearWorkspace()`.

**The run loop.** `translate()` opens the `/api/translate` SSE stream
(`lib/api.ts → translateStream`) and reduces each event into `stream` via the
`switch` in its `onEvent` handler. The event lifecycle:

```
status? → conversation* → generated → validated → (fix | stalled → validated)* →
completed | max_iterations | error
```

`conversation` events feed the Chat sidebar; the milestone events drive the result
pane's status footer and verdict. `RUNNING_STATUSES` (exported from the store) is
the shared definition of "a run is in flight".

**Debounced side-effects.** `useMappingValidation` and `useFeatureDetection`
(called once in `App.tsx`) watch `form.mappingYaml` / `form.sql` and, 400 ms after
the last edit, call `/api/validate-mapping` / `/api/detect-features` — driving the
mapping validity footer and the detected-feature chips.

**Persistence.** Zustand `persist` saves `{ theme, leftOpen, rightOpen, inputTab,
form }` under `rows2graph-web`. It's versioned (`version: 1`) with a `migrate` that
drops the obsolete `mappingOpen` flag while preserving the user's saved `form`.

## Conventions

- **`@/` import alias** → `src/` (configured in `tsconfig.json` `paths` +
  `vite.config.ts` `resolve.alias`). Import as `@/lib/api`, `@/hooks/useStore`,
  `@/components/ui/primitives` — never deep `../../` paths.
- **Design system** lives in `components/ui/primitives.tsx`. Reuse it; in particular
  `PaneHeader` (fixed `h-9` pane headers), `FooterBar` (the shared `h-9` pane
  footer), and `StatusText` (one icon+color vocabulary for success / error / warn /
  running / muted). New chrome should compose these rather than re-style ad hoc.
- **Dark mode** is class-based: `App.tsx` toggles a `.dark` class on `<html>`;
  components pair every light utility with its `dark:` variant.
- **Layout** is the Inputs ∥ Result split inside one `PanelGroup`; both editor tabs
  stay mounted and toggle via the `hidden` class so CodeMirror keeps its state.

## Develop & build

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api → http://localhost:8000
npm run build    # tsc --noEmit && vite build → dist/  (served by the backend in prod)
```

The dev server needs the backend running on `:8000` for `/api` calls to succeed.
