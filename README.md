# CodeShelf

A Steam Library-style project browser for VS Code. Point CodeShelf at the directories where your projects live and it renders them as a browsable wall of cards — grouped into shelves, with language badges, git branch, last-modified times, and optional generated poster art.

## Features

- **Automatic project discovery** — scans your configured roots for projects, detecting them by well-known markers (`package.json`, `Cargo.toml`, `go.mod`, `Gemfile`, `pyproject.toml`, `.git`, and more).
- **Shelves, booksets & super-projects** — top-level directories become shelves; nested groups become "booksets" (small ones roll up automatically, tunable via `booksetThreshold`). A directory that carries an *umbrella* marker (`docker-compose.yml`, `turbo.json`, `lerna.json`, `pnpm-workspace.yaml`, `nx.json`) is treated as a single "super-project" rather than recursed into — so a monorepo shows as one card, not a scattering of its packages.
- **Cmd/Ctrl+K quick-switcher** — a command palette that searches every project across all roots and shelves; arrow keys navigate, Enter opens (its workspace if it has one).
- **Multi-folder workspaces** — a directory containing a `.code-workspace` is surfaced as a bookset, and the card can open the whole workspace.
- **Poster art** — generate minimal SVG posters per project with the Claude CLI (if installed), or attach your own image. Injected SVG is sanitized before display.
- **Content search** — each project is indexed (README excerpt + a description/keywords blurb from its package manifest) into a small searchable corpus, so the header filter and the Cmd+K palette find a project by *what it is*, not just its name. Cmd+K shows a snippet of the matching text.
- **Star, hide, search, sort** — pin favorites, hide noise, filter across all projects or within a shelf, and sort by recency, name, or language.
- **Stale fade** — optionally dim projects you haven't touched in a while.
- **Themed & accessible** — a tokenized design system that adapts to light and dark VS Code themes, with keyboard-operable cards, focus rings, and reduced-motion support.
- **Git worktrees are skipped** so a project only appears once.

## Commands

| Command | ID | Description |
| --- | --- | --- |
| Open CodeShelf | `codeshelf.open` | Open the shelf view |
| Edit Settings (JSON) | `codeshelf.editSettings` | Jump to the `codeshelf.roots` setting |
| Clear Cache | `codeshelf.clearCache` | Drop cached shelves and saved poster prompts |
| Edit Cache | `codeshelf.editCache` | Open the cached shelf JSON for manual editing |

CodeShelf auto-opens only when you launch an **empty** VS Code window (no folder open); with a project already open it stays out of the way — use **Open CodeShelf** to summon it.

## Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `codeshelf.roots` | object | `{}` | Root directories to scan, keyed by absolute path (see below). |
| `codeshelf.booksetThreshold` | number | `8` | Booksets with this many or fewer total projects are flattened into the shelf grid. |
| `codeshelf.scanDepth` | number | `3` | Maximum directory depth to scan for projects. |
| `codeshelf.openInNewWindow` | boolean | `false` | Open projects in a new window instead of the current one. |

### `codeshelf.roots` schema

Each root is keyed by its absolute path (a leading `~` is expanded to your home directory) and may carry a label, default visibility, and per-shelf / per-project overrides:

```jsonc
{
  "codeshelf.roots": {
    "~/Workspace": {
      "label": "Work",
      "defaultVisibility": "show-all",
      "shelves": {
        "Gems": {
          "name": "Ruby Gems",
          "starred": true,
          "flatten": "auto",
          "projects": {
            "glossary": { "starred": true, "description": "Translation toolkit" }
          }
        },
        "Archive": { "hidden": true }
      }
    }
  }
}
```

Shelves and projects can be keyed either by absolute path or by directory name. `flatten` accepts `auto` (use the threshold), `always` (force a flat grid), or `never` (always keep the bookset).

## Development

```bash
npm install
npm run compile        # type-check the host + bundle the webview (esbuild)
npm run compile:check  # full type-check of host AND webview (no emit)
npm run lint           # ESLint
npm test               # vitest unit tests
npm run test:browser   # puppeteer-driven webview render tests
npm run test:all       # both suites
npm run package        # build a .vsix with vsce
```

The extension host code lives in `src/` (TypeScript, compiled with `tsc`). The webview is a React 19 app in `src/webview/` bundled by esbuild into `out-webview/`. Pure, UI-independent logic is isolated in `src/webview/components/pure.ts` and `src/shared/` so it can be unit-tested without a DOM or the VS Code API.

## License

MIT
