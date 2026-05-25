# Changelog

All notable changes to CodeShelf are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Filesystem integration tests for the directory scanner (shelf/loose rollup,
  single-child collapse, git-worktree skipping, multi-folder workspace booksets).
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
- The directory scanner parses each `.code-workspace` once per directory and
  probes project markers / sibling directories concurrently.
- Webview sort logic is unified in a single parameterized `sortProjects`, and the
  poster-prompt preview is rendered from the shared prompt builder so it can't
  drift from what is actually sent.

### Fixed
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
