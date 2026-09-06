# Changelog

All notable changes to CodeShelf are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Content search** — each project is indexed into a small search corpus matched
  by both the header filter and the Cmd/Ctrl+K palette (which shows a snippet of
  the hit). Sources: a cleaned README excerpt, the project's `.claude/CONTEXT.md`,
  a description/keywords blurb from its package manifest
  (`package.json`/`composer.json`/`Cargo.toml`/`pyproject.toml`/gemspec), **and the
  vocabulary of its own source files**. Source tokens are camel/snake-split and
  reduced to nouns + adjectives + out-of-vocabulary "custom" terms by subtracting
  a WordNet-derived "never-a-noun" denylist (verbs/adverbs/function words); the
  file walk honors `SKIP_DIRS` + each project's `.gitignore` and is bounded
  (texty extensions only, 50 files / 256KB per project). README-less projects
  (Xcode/C++/etc.) still index via their source + `.claude/CONTEXT.md`.
- **Auto keyword tags** — each project surfaces a few keyword chips chosen by
  TF-IDF over its indexed vocabulary (term frequency ÷ how many projects contain
  the term), so distinctive words win and ubiquitous ones (`def`/`data`/`end`)
  drop out. Computed in one pass after the scan and sharpens as the library grows.
  Tags exclude the project's own name (split on camelCase + `-_. `, so `TileMapper`
  never tags itself `screen`/`door`).
- **Programming-keyword filtering (dog-fooded from VS Code)** — source tokens are
  additionally filtered against a keyword denylist harvested from VS Code's *own*
  bundled TextMate grammars (`keyword`/`storage`/`constant.language` scopes across
  ~80 languages), plus a small supplement for tokens the grammars bury in larger
  patterns. So `func`/`const`/`unsigned`/`nil`/`iota` no longer leak into tags or
  search, while the SQL grammar and built-in type scopes are deliberately excluded
  (their "keywords" — `table`/`schema`/`view`/`index` — are useful project nouns).
  Regenerate with `node scripts/derive-keywords.mjs`.
  Both the header filter and the Cmd/Ctrl+K palette now match that corpus, not
  just the project name; Cmd+K shows a snippet of the matching text. Indexing
  happens during the scan (no extra `readdir`; one bounded `readFile` per
  README/manifest) and ships in `project.searchText`.
- **Git worktree decks** — a project's git worktrees (secondary checkouts whose
  `.git` is a file pointing into the main repo's `.git/worktrees/`) are no longer
  scattered as their own cards. They're collected onto the parent project, which
  renders as a stacked "deck" with a count badge; the card expands to list each
  worktree's branch and open it. Submodules (`.git/modules/`) are unaffected, and
  worktrees whose main repo is outside the scanned roots are dropped, not shown.
- **Cmd/Ctrl+K command palette** — a global quick-switcher that searches every
  project across all roots and shelves (hidden ones included), with keyboard
  navigation; Enter opens the project (its workspace if it has one).
- **Super-project classification** — a directory carrying an "umbrella" marker
  (`docker-compose.yml`/`.yaml`, `turbo.json`, `lerna.json`,
  `pnpm-workspace.yaml`, `nx.json`) but no regular project marker is now treated
  as one project card instead of being walked into as a shelf. Precedence:
  regular markers > umbrella markers > recurse.
- **Refreshed, tokenized theme**: a design-token system (spacing/type/motion
  scales, elevation, `color-mix` surface tints) with proper **light-theme
  support**, global `:focus-visible` rings, `prefers-reduced-motion` handling,
  larger hit targets, native-feeling scrollbars, and a narrow-width layout.
- **Accessibility**: project cards and collapse arrows are keyboard-operable
  (`role`, `tabIndex`, Enter/Space, `aria-expanded`); modals are `role="dialog"`.
- Filesystem integration tests for the directory scanner (shelf/loose rollup,
  single-child collapse, git-worktree skipping, multi-folder workspace booksets,
  super-project classification).
- SVG sanitization for generated/attached posters: `<script>`, inline event
  handlers, `<foreignObject>`, and `javascript:` URLs are stripped before the
  markup is injected (defense-in-depth atop the webview CSP).
- ESLint (flat config) + Prettier config, and `lint` / `format` npm scripts.
- `@types/react`, `@types/react-dom`, and `@types/canvas-confetti` so the webview
  is fully type-checked by `compile:check`.
- This CHANGELOG and a project README.

### Changed
- **Directory classification is now the git-repository boundary**, replacing a
  precedence chain of marker checks. Things versioned together are one project;
  things versioned separately are independent — one cheap observable that yields
  all three layer kinds at any depth: `project` (the dir IS a repo, so its
  marker-bearing children are components), `category` (not a repo, its children
  are projects → a shelf), `grouping` (projects live deeper → recurse; the roots
  land here too). A monorepo with one `.git` is a super-project for free, so
  umbrella markers are now just an explicit declaration. A project marker no
  longer stops recursion on a directory that plainly holds 2+ independent
  projects. New `classifyDirectory()` / `isProjectDir()` are exported and tested.
- **A `.codeshelf` file (`kind: project` | `kind: category`) overrides inference**
  at any directory — the escape hatch for what no structural signal can know
  (two independent repos a human considers one product).
- **Removed `ROLLUP_THRESHOLD`, `rollupItems`/`rollupShelf`, and single-child
  collapse.** These were presentation hacks that renamed projects
  (`Store/api`) and tipped small categories into a synthetic "Projects" heap,
  which is what made placement feel arbitrary. A category is now a shelf at any
  size; small ones render compact and sit side by side in the wrapping
  `.root-shelves` row. Project names are never prefixed.
- **Booksets render as actual groups again.** `collectProjects()` flattened every
  bookset into one grid, so the whole `.bookset` stylesheet was dead code and
  `flatten` had no visible effect at any setting. A bookset now renders as a
  named group with a count badge; `codeshelf.booksetThreshold` finally means what
  the README says (booksets at or under it flatten into the shelf grid), and
  `flatten: 'never' | 'always'` force it either way.
- **Each project appears exactly once.** A `.code-workspace` can list folders
  anywhere on disk (platform's names `../Gems/widgets`, `../lib`,
  `../../elsewhere/tool`), so a project could be shown both inside a
  workspace bookset and at its real home. The repo boundary now outranks the
  workspace-as-bookset heuristic — a directory that IS a project is one card —
  and a final pass gives every path a single owner, preferring the shelf that
  physically contains it.
- The synthetic loose shelf is named "Loose Projects" when a real directory in
  the same root is already called "Projects".
- Activation is now `onStartupFinished` instead of `*`, and the shelf auto-opens
  only in an empty window (no workspace folder open) rather than on every launch.
- The directory scanner reads each directory once (one `readdir`, resolving
  markers by set membership) instead of up to three `readdir`s + ~16 `access()`
  probes per directory, with bounded concurrency.
- The webview bundle is now minified in production builds (~660KB → ~230KB).
- `ProjectCard` is memoized and the root grouping is `useMemo`-cached, so a
  single poster load no longer re-renders (and re-parses the SVG of) every card.
- Webview sort logic is unified in a single parameterized `sortProjects`, and the
  poster-prompt preview is rendered from the shared prompt builder so it can't
  drift from what is actually sent.
- The whole codebase is free of `as` type assertions (`src/` and `test/`).

### Fixed
- **Shelves rendered every card as a thin sliver.** `.shelf-row-content` is a
  grid with a capped height, and a grid item whose `overflow` isn't `visible`
  (every `.project-card`) contributes a zero automatic minimum size — so the
  track algorithm compressed all implicit rows to fit the cap. A 70-project
  shelf drew 11px slivers of poster with all text clipped. Fixed with
  `align-content: start` + `grid-auto-rows: max-content`; the cap was also
  raised (a card with tag chips is ~270px, so the old 230px sliced the tags off
  every card in every shelf).
- **Large shelves silently hid projects.** The `has-overflow` fade hint was
  never applied by any component and there was no expand control, so a shelf
  showed one row and dropped the rest with no affordance. Now shows the fade
  plus a **"Show all N" / "Show less"** toggle.
- **Filtering a shelf made the whole section vanish.** A zero-match filter
  returned `null` for the entire section — including the filter input being
  typed into — leaving no way to clear it. Now the shelf keeps its header and
  shows an empty state with a "Clear filter" button. Additionally the global
  header search no longer silently overrides a per-shelf filter (they were
  sharing one variable); the two narrow independently.
- **Small shelves stacked their cards vertically and clipped them.** A
  `shelf-compact` shelf (≤3 projects) shrink-wraps so several can sit side by
  side, but its inner grid kept auto-fill columns and collapsed to one column.
- **A lone `*.code-workspace` swallowed whole categories.** The file is a
  `GLOB_MARKER`, so a folder carrying only a cosmetic workspace file (e.g.
  `{folders:[{path:"."}], settings:{"window.title":"🎮 Games"}}`) was treated
  as one project and never recursed into — hiding ~31 real projects across six
  directories, including `Games/`'s six games and `vscode/` itself. It is now
  a weak signal: if it is the only marker and the directory holds 2+ projects,
  the directory is a collection. Dirs with any other marker are unaffected.
- **Keyword tags were not searchable.** Tags render as chips on every card but
  `projectMatchesQuery` only checked name + corpus, so searching a tag you could
  see returned nothing. Tags are now matched, and the shelf-detail modal uses the
  same matcher as the header, palette, and per-shelf filter (it was name-only).
- The open project-detail modal now re-derives from the latest scan instead of
  showing a stale open-time snapshot.
- Confetti bursts cancel their pending staggered timers on rescan/unmount.
- Both message-protocol switches have compile-time exhaustiveness guards, so a
  renamed/added variant can no longer be dropped silently.
- React 19 `useRef` call that compiled only because React types were missing.
- Leaked `editCache` document listeners are now registered on the extension's
  subscriptions.

### Removed
- Dead `project:showDetail` and `item:editMeta` message types (and the unused
  `item:editMeta` handler).

## [0.1.0]

- Initial CodeShelf: project discovery across configured roots, shelves and
  booksets, poster generation/attachment, star/hide/search/sort, stale fade,
  and multi-folder workspace support.
