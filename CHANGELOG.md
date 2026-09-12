# Changelog

All notable changes to CodeShelf are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

0.2.0 is the first release published to the Marketplace. Earlier versions mark
development milestones reconstructed from the project history; they were never
published.

## [0.2.0]

First public release (preview).

### Changed
- **Classification follows the git repository boundary.** A directory that is a
  repo is one project and its contents are components; a directory whose
  children are repos is a shelf; anything else is looked through. Monorepos,
  nested groups and deeply buried projects need no depth limits or naming
  conventions. A project marker such as a stray `Makefile` or a cosmetic
  `.code-workspace` no longer hides the independent projects beneath it.
- **A category is a shelf at any size.** Projects keep their own names instead
  of being prefixed with their parent folder.
- **Shelves take only the room they need.** Each shelf claims as many columns
  as its cards or its own title row require, so small shelves share a row with
  a grouping border, and the layout tracks the window width.
- **A large shelf previews exactly its first row** and says how many more it
  holds ("Show 12 more").
- **Shelf controls stay visible** at a low-contrast rest state instead of
  appearing only on hover.
- **Rebuilt theme.** Surfaces are derived from the active VS Code theme's own
  colours, so light and dark both render correctly; recency is set as an
  aligned, scannable column.
- **Keyword tags drop language keywords** (`end`, `nil`, `func`, `unsigned`…)
  using a denylist harvested from VS Code's own syntax grammars, and a project
  no longer tags itself with its own name.
- **Poster generation runs isolated** from your own Claude settings, hooks and
  MCP servers, confined to the project directory, and times out after two
  minutes.

### Added
- **Workbench view** — an "on the bench" strip of projects touched in the last
  fortnight, with descriptions and a direct open button, and a heat edge on
  every card from hot to frozen.
- **Timeline view** — the library stratified by age: Today, This week, This
  month, Months, This year, The deep past.
- The chosen view is remembered.
- **Language filter chips** across all views, including a chip for projects
  with no detected language.
- **Git worktrees** collect onto their parent project as a stacked deck.
- **`.codeshelf` override** — a one-line `kind: project` or `kind: category`
  file settles any folder that is genuinely ambiguous.
- **Monorepo badge** showing how many packages an umbrella-marked project
  contains.
- Marketplace listing: icon, licence, repository links.

### Removed
- The small-group rollup, single-child folder collapsing and the synthetic
  heap they fed. They made placement feel arbitrary.

### Fixed
- Poster generation never returned: the Claude CLI was left waiting on input.
- Cancelling a poster now stops every process it started and no longer reports
  an error.
- Un-starring or un-hiding a project or shelf failed to save.
- Cards in shelves with many rows were squeezed into thin slivers.
- Large shelves silently hid most of their projects with no way to expand.
- A per-shelf filter with no matches removed the whole shelf, including the
  filter box, so it could not be cleared.
- The header search overrode per-shelf filters; they now narrow independently.
- Tags shown on cards were not searchable, and the shelf detail view matched
  names only.
- Booksets rendered as a flat grid instead of named groups.
- The packaged extension shipped 650 files (1.52 MB) of dependency previews and
  source maps; it is now 36 files (about 250 KB).

## [0.1.4] - 2026-06-04

### Added
- **Content search.** Each project is indexed from its README, its
  `.claude/CONTEXT.md`, its package manifest description and keywords, and the
  vocabulary of its own source files. The file walk is bounded and honours
  `.gitignore`. The header filter and the palette both match it, and the palette
  shows a snippet of why a project matched.
- **Keyword tags** chosen by TF-IDF across the whole library, so they are the
  words that make a project distinctive, shown as chips on each card.

## [0.1.3] - 2026-06-02

### Added
- **Cmd/Ctrl+K palette** searching every project across every root, hidden
  ones included, fully keyboard driven.
- **Super-projects.** A folder carrying an umbrella marker (`docker-compose.yml`,
  `turbo.json`, `lerna.json`, `pnpm-workspace.yaml`, `nx.json`) opens as one
  project rather than being split into a shelf.

### Changed
- Design-token theme with visible focus rings, reduced-motion support and
  keyboard-operable cards, collapse controls and dialogs.
- Faster scans (one directory read per folder) and a minified webview bundle.
- A poster arriving re-renders only its own card.

### Fixed
- Light themes rendered with hard-coded dark tints.
- Starring or hiding the loose projects shelf had no effect.

## [0.1.2] - 2026-05-25

### Added
- **CodeShelf: Clear Cache** and **CodeShelf: Edit Cache** commands.
- Staggered card entrance, and a celebration when a rescan finds new projects.

### Changed
- Activates after startup instead of on every event, and opens automatically
  only in an empty window.
- Scans read sibling folders concurrently, with a bound on open file operations.

### Security
- Poster SVG is sanitised before it is rendered: scripts, event handlers,
  `<foreignObject>` and `javascript:` URLs are stripped.

### Fixed
- Icons were missing from the packaged extension.

## [0.1.1] - 2026-03-30

### Added
- **Shelf detail view** with its own filter, and an inline filter on each shelf
  row.
- **Sort** by recent, name or language, and an optional **stale fade** that dims
  projects by age.
- **Multi-folder `.code-workspace` files** become a group of projects.
- Star, hide and reveal buttons on shelves.

### Changed
- The webview was rewritten in React.
- Shelves preview a single row.
- Git worktrees are no longer listed as separate projects.

### Fixed
- Unhiding a small shelf immediately folded it back into the loose projects row.

## [0.1.0] - 2026-03-29

First working version.

### Added
- **Project library** in an editor tab: configured root folders are scanned for
  projects by marker files and grouped into shelves and booksets, under
  collapsible root headers. Results are cached for instant display and refreshed
  in the background.
- **Star and hide** for shelves and projects, stored in `codeshelf.roots`, with
  hidden shelves shown as pills for a quick unhide.
- **Booksets** at or under `codeshelf.booksetThreshold` projects flatten into
  their shelf, with a per-shelf `flatten` override.
- **Project detail view** with its git branch, language and last change.
- **Poster art.** Generate an SVG poster for a project with the Claude CLI,
  optionally guided by your own prompt (remembered per project), or attach your
  own image. Generation can be cancelled, and the CLI may read the project but
  not change it.
- Opens `.code-workspace` files instead of bare folders where one exists.
