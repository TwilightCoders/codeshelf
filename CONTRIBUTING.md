# Contributing

## Layout

The extension host is TypeScript in `src/`, compiled with `tsc` to `out/`. The
webview is a React 19 app in `src/webview/`, bundled by esbuild into
`out-webview/`.

Pure, UI-independent logic lives in `src/webview/components/pure.ts` and
`src/shared/` so it can be unit-tested without a DOM or the VS Code API. Anything
importing `helpers.ts` pulls in `acquireVsCodeApi()` and cannot be loaded by the
node test runner — if a function is testable, it belongs in `pure.ts`.

## Commands

```bash
npm install
npm run compile        # type-check the host + bundle the webview
npm run compile:check  # full type-check of host AND webview (no emit)
npm run lint           # ESLint
npm test               # vitest unit tests
npm run test:browser   # puppeteer-driven webview render tests
npm run test:all       # both suites
npm run package        # build a .vsix with vsce
```

Run `compile:check`, `lint` and both test suites before packaging.

## Dev harness

`dev.html` runs the webview in a plain browser against a mock extension host
(`src/webview/dev/mockHost.ts`). The mock is type-checked against the same
`WebviewToExt` / `ExtToWebview` unions as the real host, so a renamed message
breaks the build rather than drifting silently.

Useful scripts:

| Script | What it does |
| --- | --- |
| `node scripts/theme-preview.mjs <css> <out.png> [--light]` | Render a stylesheet against your real scanned library, light or dark |
| `node scripts/theme-coverage.mjs <css>` | Report classes the components use that a stylesheet never styles |
| `node scripts/demo-shots.mjs` | Regenerate the README screenshots from synthetic data |
| `node scripts/derive-keywords.mjs` | Regenerate the programming-keyword denylist from VS Code's bundled grammars |
| `node scripts/derive-nonnouns.mjs` | Regenerate the WordNet "never-a-noun" denylist |

## Generated files

`src/services/nonNouns.generated.ts` and
`src/services/programmingKeywords.generated.ts` are generated and committed. They
are ESLint-ignored. Regenerate with the scripts above rather than editing them.

## Classification

How CodeShelf decides what is a project, a category and a grouping — and the
measurements behind those choices — is documented in
[`docs/classification-heuristics.md`](docs/classification-heuristics.md). Read it
before changing the scanner; several plausible-sounding heuristics were tried and
measured at ~0% signal.
