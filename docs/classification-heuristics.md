# Directory classification

How CodeShelf decides what a scanned directory is — a **project**, a **category**
of projects, or a **grouping** to look deeper into — and the measurements behind
those choices. Read this before changing the scanner: several plausible
heuristics were tried against a real library and found to carry no signal.

## The model

The **git repository boundary** is the observable that carries the signal.
Things versioned together are one project; things versioned separately are
independent. One cheap check yields every layer kind, at any depth, for any
folder structure:

```
classify(dir):
  isProjectDir(dir)                  → project    # it IS a repo; children are components
  else any child is a project        → category   # a shelf
  else projects exist deeper         → grouping   # recurse (roots land here too)
  else                               → empty

isProjectDir(dir):                               # precedence, highest first
  .codeshelf declares kind           → that
  .git is a directory                → project   # the coupling boundary
  umbrella marker present            → project   # explicit "this is one thing"
  a project marker present           → project ONLY IF it has <2 project children
  otherwise                          → not a project
```

Examples:

| layout | classified as |
|---|---|
| `platform/` — one repo holding `api/`, `web/`, `worker/` | **project** (one card) |
| `gems/` — a dozen independent repos side by side | **category** (a shelf) |
| `archive/2019/<repos>` | `archive/` is a **grouping**; `2019/` is a category |

A monorepo with a single `.git` is a super-project without special-casing, so
umbrella markers (`docker-compose.yml`, `turbo.json`, `lerna.json`,
`pnpm-workspace.yaml`, `nx.json`) are only an explicit declaration for roots that
aren't repos themselves.

### Why the last clause of `isProjectDir` matters

A marker must not stop recursion on a directory that plainly holds several
independent projects. The case that forced this: a `*.code-workspace` file
dropped on a category folder purely to set a window title
(`{"folders":[{"path":"."}],"settings":{"window.title":"…"}}`). Treated as a
project marker, it collapsed the whole folder into one card and hid every project
beneath it. A stray build `Makefile` beside several repos does the same. A `.git`
directory always wins, because that is the boundary.

### The `.codeshelf` override

A file containing `kind: project` or `kind: category` at any directory outranks
every inferred signal. It exists for the case no structural signal can decide:
two or more independent repos that a person nonetheless thinks of as one product
(say `store/api` and `store/infrastructure`, each its own repo, nothing shared at
the parent).

## Heuristics that were tried and rejected

An earlier design treated "category vs. parent project" as a question of
**coupling**, to be inferred from structural evidence. Every proposed signal was
measured against a real single-developer library of about three hundred
projects. None separated the two:

| signal | result |
|---|---|
| a `README` in the wrapper directory marks a parent project | **0** of 16 wrapper directories had one — including the ones that are conceptually a single product |
| sibling directories referencing each other (imports, relative dependency paths, submodules) | **0** hits across every wrapper tested |
| children sharing a git remote organisation | shared by effectively every project, so no discrimination |
| children sharing a git author or overlapping history | same author throughout, so no discrimination |

These signals may discriminate in a multi-author, multi-organisation tree. In a
personal library they don't, which is the common case for this tool. Do not
reintroduce them without new measurements.

What does separate the cases is the repository boundary above — and where even
that can't, the answer is an explicit declaration, not a cleverer guess.

## Presentation rules

Classification decides *what* a directory is; these decide how it is shown.

- **A category is a shelf at any size.** There is no rollup threshold and project
  names are never prefixed with their parent. Earlier versions flattened small
  groups into a synthetic "Projects" shelf and renamed their projects
  (`store/api`), which made placement feel arbitrary.
- **No wasted rows.** A shelf claims only the columns its cards need; small shelves
  share a row and carry a grouping border. The minimum width is the shelf's own
  title row, measured rather than fixed.
- **One row, then expand.** A large shelf previews exactly its first row and
  offers "Show N more".
- **Nested categories are booksets** inside the parent shelf. A bookset at or
  under `codeshelf.booksetThreshold` projects is flattened into the shelf grid;
  `flatten: never | always` overrides per shelf.
- **Git worktrees** are collected onto their parent repository as a deck, never
  shown as separate cards.
- **Each project appears once.** A multi-folder `.code-workspace` can list folders
  anywhere on disk; ownership goes to the shelf that physically contains the
  project.
- **The synthetic loose shelf** holds projects that sit directly in a root. It is
  named "Loose Projects" if a real directory in that root is already called
  "Projects".

## Code pointers

- `src/shared/constants.ts` — `PROJECT_MARKERS`, `GLOB_MARKERS`, `UMBRELLA_MARKERS`, `SKIP_DIRS`
- `src/services/projectScanner.ts` — `classifyDirectory`, `isProjectDir`, `readDeclaration`, `collectIfWorktree`, `dedupeProjects`, `scanDirectory`, `scanRoots`
- `src/services/workspaceFile.ts` — `.code-workspace` parsing
- `src/webview/components/ShelfRow.tsx` — spanning, preview sizing, bookset flattening
- Tests: `test/scannerFs.test.ts` exercises classification against a real directory fixture
