# 10 — Component Architecture

**Project:** SyntaxLab
**Status:** Draft for human review
**Last updated:** 2026-08-17

---

> **Scope note (Phase 1.5).** V1.0 builds the regex and JSON feature trees. Cron components (§4.3) are **V1.1**. The share dialog is removed from V1.0 with the deferred feature.

## 1. Principles

1. **Presentational by default.** Components render props. Data fetching, parsing, and persistence live in the application layer.
2. **One responsibility per component.** If a component's name needs "and", split it.
3. **Composition over configuration.** A `<Panel>` with children beats a `<Panel>` with fifteen boolean props.
4. **A soft 200-line ceiling.** Not dogma, but a component past it usually contains a second component.
5. **Feature-local by default.** A component is promoted to `components/` only when a *second* feature actually needs it. Speculative sharing produces the wrong abstraction.
6. **Every component is renderable in isolation** with props alone — which is what makes them testable without mounting the app.

---

## 2. Tree

> **Built at M1** (marked ✅). Everything else is scheduled to its milestone.
> The shell tree below is the current implementation, not an intention.

```
<App>                                   ✅ M1
└── <ErrorBoundary scope="app">         ✅ M1
    └── <AppShell>                      ✅ M1
        ├── <Header>                    ✅ M1
        │   ├── wordmark + tagline      ✅ M1
        │   └── <ModeSelector/>         ✅ M1  radiogroup, roving tabindex
        │
        ├── <WorkspacePlaceholder>      ✅ M1  real layout, no editor yet
        │   ├── <ErrorBoundary scope="input">     ✅ M1
        │   │   └── input pane + ECMAScript label ✅ M1
        │   └── <ErrorBoundary scope="analysis">  ✅ M1
        │       └── analysis pane                 ✅ M1
        │
        └── <StatusBar/>                ✅ M1  polite live region
```

M3 added no components either — it is domain and worker work only. The regex
feature components arrive at M4.

M2 added no components. It added `src/app/devWorkerHarness.ts`, which renders
nothing: it attaches a control surface to `window` under `import.meta.env.DEV`
so the E2E suite can drive real workers, and is dropped from production builds.

Header actions (history, theme, help) are **not** rendered at M1. They arrive
with the features they open (M7, M8, M10). Rendering them now as inert buttons
would be the disabled-affordance defect the UX spec rules out (§2.1) — a
control that does nothing reads as broken, not as pending.

### 2.1 Target tree



```
<App>
└── <ErrorBoundary scope="app">
    └── <AppShell>
        ├── <Header>
        │   ├── <Wordmark/>
        │   ├── <ModeSelector/>              radiogroup
        │   └── <HeaderActions>
        │       ├── <OfflineChip/>           conditional
        │       ├── <HistoryPausedChip/>     conditional
        │       ├── <IconButton icon="history"/>
        │       ├── <IconButton icon="theme"/>
        │       └── <IconButton icon="help"/>
        │
        ├── <UpdateBanner/>                  conditional
        ├── <DetectionSuggestion/>           conditional
        │
        ├── <Workspace>                      resizable split
        │   ├── <ErrorBoundary scope="input">
        │   │   └── <InputPane>
        │   │       ├── <RegexInput/> | <JsonInput/>        (<CronInput/> in V1.1)
        │   │       └── <InputFooter/>       char count, limit warning
        │   ├── <SplitHandle/>
        │   └── <ErrorBoundary scope="analysis">
        │       └── <AnalysisPane>
        │           └── <RegexAnalysis/> | <JsonAnalysis/>  (<CronAnalysis/> in V1.1)
        │
        ├── <StatusBar>
        │   ├── <ValidityIndicator/>
        │   ├── <AnalysisStats/>
        │   └── <ActionBar/>                 copy · clear
        │
        ├── <FirstRunHistoryNotice/>        conditional, once
        ├── <HistoryDrawer/>                 lazy
        ├── <ThemeDrawer/>                   lazy
        ├── <HelpDialog/>                    lazy
        └── <ToastRegion/>
```

### Error-boundary placement

Three boundaries, deliberately placed rather than sprinkled:

| Scope | Catches | Result |
|---|---|---|
| `app` | Anything escaping the others | Full-page recovery screen with a reset action |
| `input` | Editor crashes (a CM6 extension bug) | Input pane shows a recovery card; **analysis and history remain usable** |
| `analysis` | Rendering crashes (a malformed tree, an explanation bug) | Analysis pane shows a recovery card; **the user's input is preserved** |

The point of the two inner boundaries is that a crash never costs the user their input. That is the only thing in this app that cannot be recomputed.

---

## 3. Shared components

### 3.1 `<CodeEditor>` — the one CodeMirror wrapper

```ts
interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: 'regex' | 'json' | 'plain';
  placeholder?: string;
  readOnly?: boolean;
  maxLength: number;
  diagnostics?: Diagnostic[];        // squiggles from the parser
  highlights?: HighlightRange[];     // match highlighting / span linking
  ariaLabel: string;
  ariaDescribedBy?: string;
  onCursorChange?: (pos: number) => void;
}
```

**One wrapper, not several.** Every editor surface (regex pattern, regex test string, JSON — and the cron expression in V1.1) differs only in language extension and configuration. Near-identical wrappers would be several places to fix every CM6 quirk.

Responsibilities: create and destroy the `EditorView`, reconcile external value changes without fighting the user's cursor, apply diagnostics and highlights as decoration sets, apply theme tokens, enforce `maxLength` on paste and input, and expose the accessibility attributes.

Language modes are **lazy-imported** — the JSON language package loads only when JSON mode is first used.

The classic bug this wrapper must get right: an uncontrolled external `value` update that resets the cursor to position 0 on every keystroke. The wrapper compares the incoming value against the view's current document and dispatches a transaction only on a genuine difference.

### 3.2 `<TreeView>` — shared by JSON and regex AST

```ts
interface TreeViewProps<T> {
  nodes: T[];
  getKey: (n: T) => string;
  getChildren: (n: T) => T[] | undefined;
  renderNode: (n: T, state: NodeState) => ReactNode;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
  onSelect?: (n: T) => void;
  virtualizeThreshold?: number;   // default 500 visible rows
}
```

Generic over node type; each feature supplies its own `renderNode`. Handles expansion state, keyboard navigation (`↑ ↓ ← → Home End`), `role="tree"` semantics, and virtualisation.

**Virtualisation is hand-rolled**, not `react-window`. The requirement is a single fixed-row-height vertical list — roughly 60 lines of "slice by scroll offset, pad with spacers". Pulling in a windowing library for one list is a rung-5 violation. If a variable-height or horizontal case ever appears, revisit.

### 3.3 Primitives

| Component | Notes |
|---|---|
| `<Button>` | Variants: primary, secondary, ghost, danger. Sizes: sm, md. Loading state disables and announces. |
| `<IconButton>` | Requires `label`; renders `aria-label` + tooltip. Type-level requirement, not convention. |
| `<Drawer>` | Focus trap, `Escape`, restore focus, `aria-modal`, background inert, slide animation |
| `<Dialog>` | As above, centred, with a required labelled heading |
| `<Tabs>` | Roving tabindex, `role="tablist"`, arrow-key navigation |
| `<Toggle>` | `role="switch"`, `aria-checked` |
| `<Select>` | Native `<select>` styled. Not a custom listbox — native gets keyboard, screen-reader, and mobile behaviour correct for free. |
| `<ColorInput>` | Native `<input type="color">` + validated hex text field |
| `<Slider>` | Native `<input type="range">` with a value label |
| `<Toast>` | `role="status"`, auto-dismiss, pauses on hover/focus |
| `<Panel>` | Titled section with optional collapse; the layout unit of the analysis pane |
| `<Badge>` | Type/status pills; always text, never colour-only |
| `<CopyButton>` | Copy + transient "Copied" confirmation + `aria-live` announcement |
| `<EmptyState>` | Icon, headline, description, optional actions |
| `<ErrorState>` | What failed, where, what next, recovery action |

Every primitive is a plain function component with no state beyond local UI concerns. `<Select>` and `<Slider>` being native is a deliberate rung-4 choice: the platform already solved them, and every custom reimplementation regresses accessibility.

---

## 4. Feature components

### 4.1 Regex

```
<RegexInput>
  ├── <CodeEditor language="regex"/>
  ├── <RegexFlagBar/>          seven toggles
  └── <RegexExamplePicker/>

<RegexAnalysis>
  ├── <Panel title="Explanation">
  │   ├── <ExplanationSummary/>
  │   └── <TokenTable/>          hover ↔ editor span link
  ├── <Panel title="Structure">
  │   └── <TreeView renderNode={RegexNodeRow}/>
  ├── <Panel title="Groups">
  │   └── <GroupTable/>
  ├── <WarningList/>
  └── <Panel title="Test">
      ├── <CodeEditor language="plain" ariaLabel="Test string"/>
      ├── <MatchHighlightOverlay/>
      └── <MatchTable/>          or <TimeoutState/> / <NoMatchesState/>
```

The hover-link between `<TokenTable>` and the editor is coordinated by a single `hoveredSpan` value in the feature's local state — not a global store, since nothing outside this feature needs it.

### 4.2 JSON

```
<JsonInput>
  ├── <CodeEditor language="json" diagnostics={errors}/>
  └── <JsonToolbar/>             format · minify · indent

<JsonAnalysis>
  ├── <JsonErrorReport/>         first, when invalid
  ├── <Panel title="Structure">
  │   ├── <JsonTreeToolbar/>     expand/collapse · search
  │   └── <TreeView renderNode={JsonNodeRow} virtualize/>
  ├── <JsonPathBar/>             selected node path + copy
  ├── <JsonStatsLine/>           one line, not a card grid
  └── <JsonFindings/>            duplicate keys · unsafe numbers
```

### 4.3 Cron — **V1.1, not built in V1.0**

```
<CronInput>
  ├── <CodeEditor language="plain"/>   field-coloured decorations
  ├── <CronDialectSelect/>
  ├── <CronTimezoneSelect/>
  └── <CronPresetPicker/>

<CronAnalysis>
  ├── <CronSummary/>             the large plain-English statement
  ├── <Panel title="Fields"><CronFieldTable/></Panel>
  ├── <Panel title="Next runs"><NextRunsList/></Panel>
  ├── <CronWarnings/>            DOM/DOW OR-rule, DST
  └── <Panel title="Builder" collapsible><CronBuilder/></Panel>
```

`<CronBuilder>` is the most stateful component in the app: it must stay bidirectionally synchronised with the text expression. Rule — **the expression string is the single source of truth**. The builder derives its control values from the parsed expression and, on change, writes a new expression string. It never holds independent state. This eliminates the entire class of "the builder and the text box disagree" bugs.

### 4.4 History and theme

```
<HistoryDrawer>
  ├── <HistorySearch/>
  ├── <HistoryFilters/>
  ├── <HistoryList>  └── <HistoryEntryRow/>*
  ├── <HistoryEmptyState/> | <StorageUnavailableState/>
  └── <HistoryActions/>      export · import · clear all

<ThemeDrawer>
  ├── <PresetGrid/>
  ├── <GradientControls/>
  ├── <InterfaceControls/>
  ├── <ContrastCheck/>
  └── <ResetButton/>
```

---

## 5. Data flow into components

```mermaid
graph TD
    S["Stores<br/>workspace · history · theme · ui"] -->|useSyncExternalStore| H["Feature hooks<br/>useRegexAnalysis, useHistory, …"]
    H -->|plain props| C["Presentational components"]
    C -->|callbacks| UC["Use-cases"]
    UC --> S
    UC --> W["WorkerClient"]
    UC --> R["Repositories"]
```

**Only hooks read stores.** Presentational components receive props. This is what keeps them renderable in a test without any provider setup, and it makes the data dependencies of every component visible in its signature.

Feature hooks are the seam:

```ts
function useRegexAnalysis() {
  const input  = useWorkspaceStore(s => s.input);
  const flags  = useWorkspaceStore(s => s.regexFlags);
  const result = useWorkspaceStore(s => s.result);
  const status = useWorkspaceStore(s => s.status);
  return { input, flags, result, status, setInput, toggleFlag, analyze };
}
```

Selector-based subscriptions mean a component re-renders only when the slice it reads changes — the mechanism that keeps typing at 60 fps while an analysis pane is mounted.

---

## 6. Code splitting

| Chunk | Contents | Load trigger |
|---|---|---|
| `index` | Shell, header, stores, tokens, one editor | Initial |
| `regex` | Regex feature UI | Regex mode selected (default) |
| `json` | JSON feature UI + CM JSON language | JSON mode selected |
| `cron` *(V1.1)* | Cron feature UI | Cron mode selected |
| `history` | History drawer | Drawer opened |
| `theme` | Theme drawer | Drawer opened |

| `help` | Help dialog | Help opened |
| `analysis.worker` | Domain parsers | First analysis |
| `exec.worker` | Regex execution | First regex test |

All lazy boundaries use `React.lazy` + `Suspense` with a skeleton matching the final layout — no layout shift.

**Prefetch policy:** on idle after first paint, prefetch the other mode's chunk (`json` when starting in regex, and vice versa) — mode switching should feel instant. Do **not** prefetch drawers; most sessions never open them.

---

## 7. Performance rules for components

1. `React.memo` **only where measured**. Blanket memoisation adds comparison cost and obscures real problems.
2. Stable callbacks (`useCallback`) for props passed to memoised children — otherwise the memo does nothing.
3. Selector subscriptions, never whole-store subscriptions.
4. Editor value is **uncontrolled inside CM6**; React holds a debounced mirror. A fully controlled 5 MB document through React state would drop every frame.
5. Lists over ~500 rows virtualise.
6. Keys are stable IDs, never array indices — index keys corrupt state on reorder, and the history list reorders on every pin.
7. No expensive work in render. Derivations are memoised or precomputed in the worker.

---

## 8. Testing components

| Layer | Approach |
|---|---|
| Primitives | React Testing Library: render, interact, assert accessible output |
| Feature components | Render with fixture props; no store, no mocks needed |
| Feature hooks | `renderHook` with a fake repository and a fake worker client |
| Integration | Full workspace with real stores and fakes for infrastructure |
| Accessibility | `axe-core` on every primitive and every primary view |
| Visual | Playwright screenshots of key states, default theme only (custom-theme snapshots are noise) |

Queries are by **role and accessible name**, never by test id or class. A test that cannot find a button by its accessible name has found a real accessibility bug.
