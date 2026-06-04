# Changelog

All notable changes to CodeShelf are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Content search** — each project is indexed into a small search corpus (a
  cleaned README excerpt + a description/keywords blurb from its package
  manifest: `package.json`/`composer.json`/`Cargo.toml`/`pyproject.toml`/gemspec).
  Both the header filter and the Cmd/Ctrl+K palette now match that corpus, not
  just the project name; Cmd+K shows a snippet of the matching text. Indexing
  happens during the scan (no extra `readdir`; one bounded `readFile` per
  README/manifest) and ships in `project.searchText`.
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
