import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanRoots, classifyDirectory } from '../src/services/projectScanner';
import type { Shelf } from '../src/shared/types';

// ── Filesystem fixture ──
//
// Builds a real directory tree in a tmpdir and exercises scanRoots end-to-end.
// This covers scanDirectory/scanRoots — the recursive walk, single-child
// collapse, rollup, worktree skipping, and workspace-as-bookset — which the
// pure-function tests in scanner.test.ts do not reach.

let root1: string;
let root2: string;
let root3: string;
let tmp: string;
let wtDir: string;
let games: string;
let superRepo: string;
let declaredStore: string;
let sharedProj: string;
let solows: string;

async function mkproj(dir: string, marker: string, contents = '{}') {
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, marker), contents);
}

beforeAll(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codeshelf-scan-'));
  root1 = path.join(tmp, 'root1');
  root2 = path.join(tmp, 'root2');
  root3 = path.join(tmp, 'root3');

  // root1: loose project + a real shelf + single-child collapse + a worktree
  await mkproj(path.join(root1, 'soloProj'), 'package.json');

  await mkproj(path.join(root1, 'Apps', 'a'), 'Gemfile', 'source "x"');
  await mkproj(path.join(root1, 'Apps', 'b'), 'Cargo.toml');
  await mkproj(path.join(root1, 'Apps', 'c'), 'go.mod');
  await mkproj(path.join(root1, 'Apps', 'd'), 'package.json');
  await mkproj(path.join(root1, 'Apps', 'e'), 'pyproject.toml');
  // A git worktree (.git is a FILE, not a dir) with no other markers — skipped
  await fs.promises.mkdir(path.join(root1, 'Apps', 'wt'), { recursive: true });
  await fs.promises.writeFile(path.join(root1, 'Apps', 'wt', '.git'), 'gitdir: /elsewhere/.git/worktrees/wt');

  // Tiny has exactly one child project → single-child collapse → absorbed loose
  await mkproj(path.join(root1, 'Tiny', 'only'), 'package.json');

  // A loose project with a README + manifest description, for search indexing.
  await fs.promises.mkdir(path.join(root1, 'helix-tunnel'), { recursive: true });
  await fs.promises.writeFile(path.join(root1, 'helix-tunnel', 'package.json'),
    JSON.stringify({ name: 'helix-tunnel', description: 'QUIC reverse tunnel', keywords: ['multiplexing'] }));
  await fs.promises.writeFile(path.join(root1, 'helix-tunnel', 'README.md'),
    '# Helix Tunnel\n\nLow-latency reverse tunnel built on QUIC. Esperanto-friendly.\n');

  // A README-less Xcode-style project that documents itself only in
  // .claude/CONTEXT.md (the Cortex case): no README, no indexable manifest.
  await fs.promises.mkdir(path.join(root1, 'cortex', 'cortex.xcodeproj'), { recursive: true });
  await fs.promises.mkdir(path.join(root1, 'cortex', '.claude'), { recursive: true });
  await fs.promises.writeFile(path.join(root1, 'cortex', '.claude', 'CONTEXT.md'),
    '# Cortex\n\nA spiking neural network simulator written in C++.\n');

  // A project whose key term lives only in SOURCE (not docs) + a .gitignore'd
  // file that must NOT be indexed.
  await fs.promises.mkdir(path.join(root1, 'synapse'), { recursive: true });
  await fs.promises.writeFile(path.join(root1, 'synapse', 'CMakeLists.txt'), 'project(synapse)\n');
  await fs.promises.writeFile(path.join(root1, 'synapse', 'brain.cpp'), '// a spiking neural network\nint axon() { return 0; }\n');
  await fs.promises.writeFile(path.join(root1, 'synapse', '.gitignore'), 'secret.txt\nbuild/\n');
  await fs.promises.writeFile(path.join(root1, 'synapse', 'secret.txt'), 'confidentialword topsecret');

  // A project whose source repeats its OWN name tokens and language keywords
  // alongside one distinctive domain word — to prove name-subtraction and the
  // programming-keyword denylist (so neither the name nor keywords become tags).
  await fs.promises.mkdir(path.join(root1, 'widget-forge'), { recursive: true });
  await fs.promises.writeFile(path.join(root1, 'widget-forge', 'package.json'), JSON.stringify({ name: 'widget-forge' }));
  await fs.promises.writeFile(path.join(root1, 'widget-forge', 'forge.ts'),
    '// crucible crucible crucible crucible crucible crucible crucible\n' +
    '// widget forge widget forge widget forge widget forge\n' +
    'const unsigned = 0;\n' +
    '// unsigned unsigned unsigned const const const func func fn fn return void\n');

  // A real repo (real .git dir + go.mod) with a git worktree: a sibling dir whose
  // .git is a FILE pointing into repo-main's .git/worktrees/. The worktree must
  // NOT appear as its own card — it attaches to repo-main as a deck.
  const repoMain = path.join(root1, 'repo-main');
  await fs.promises.mkdir(path.join(repoMain, '.git', 'worktrees', 'wt1'), { recursive: true });
  await fs.promises.writeFile(path.join(repoMain, 'go.mod'), 'module repo-main\n');
  await fs.promises.writeFile(path.join(repoMain, '.git', 'worktrees', 'wt1', 'HEAD'), 'ref: refs/heads/feature-x\n');
  wtDir = path.join(root1, 'repo-main-worktrees', 'wt1');
  await fs.promises.mkdir(wtDir, { recursive: true });
  await fs.promises.writeFile(path.join(wtDir, '.git'), `gitdir: ${path.join(repoMain, '.git', 'worktrees', 'wt1')}\n`);
  await fs.promises.writeFile(path.join(wtDir, 'go.mod'), 'module wt1\n');

  // A CATEGORY dir whose only marker is a self-referential *.code-workspace (the
  // "cosmetic window title" shape) holding several real projects. It must be
  // recursed into, not collapsed into one card that swallows its children.
  games = path.join(root1, 'GamesCat');
  await fs.promises.mkdir(games, { recursive: true });
  await fs.promises.writeFile(path.join(games, 'GamesCat.code-workspace'),
    JSON.stringify({ folders: [{ path: '.' }], settings: { 'window.title': 'Games' } }));
  await mkproj(path.join(games, 'alpha'), 'package.json');
  await mkproj(path.join(games, 'beta'), 'Cargo.toml');
  await mkproj(path.join(games, 'gamma'), 'go.mod');

  // A genuine single project that ALSO ships a workspace file — must stay one card.
  solows = path.join(root1, 'soloWs');
  await fs.promises.mkdir(solows, { recursive: true });
  await fs.promises.writeFile(path.join(solows, 'soloWs.code-workspace'), JSON.stringify({ folders: [{ path: '.' }] }));
  await fs.promises.writeFile(path.join(solows, 'package.json'), '{}');

  // A repo that CONTAINS component dirs with their own markers (the platform
  // shape). The git boundary says one project, so the components are not cards.
  superRepo = path.join(root1, 'superRepo');
  await fs.promises.mkdir(path.join(superRepo, '.git'), { recursive: true });
  await fs.promises.writeFile(path.join(superRepo, 'package.json'), '{}');
  await mkproj(path.join(superRepo, 'core'), 'package.json');
  await mkproj(path.join(superRepo, 'web'), 'package.json');

  // Two independent repos a human considers one product — inference cannot know
  // that, so a `.codeshelf` declaration forces it.
  declaredStore = path.join(root1, 'DeclaredStore');
  await fs.promises.mkdir(declaredStore, { recursive: true });
  await fs.promises.writeFile(path.join(declaredStore, '.codeshelf'), 'kind: project\n');
  await mkproj(path.join(declaredStore, 'api'), 'package.json');
  await mkproj(path.join(declaredStore, 'infrastructure'), 'package.json');

  // A workspace that pulls in a project living OUTSIDE its own directory. The
  // project must appear exactly once — at its real home, not twice.
  sharedProj = path.join(root1, 'Gems', 'widgets');
  await mkproj(sharedProj, 'package.json');
  await mkproj(path.join(root1, 'Gems', 'other'), 'package.json');
  const refDir = path.join(root1, 'RefWs');
  await fs.promises.mkdir(refDir, { recursive: true });
  await mkproj(path.join(refDir, 'local'), 'package.json');
  await fs.promises.writeFile(path.join(refDir, 'ref.code-workspace'),
    JSON.stringify({ folders: [{ path: './local' }, { path: '../Gems/widgets' }] }));

  // root2: a multi-folder .code-workspace → bookset shelf "WS"
  const ws = path.join(root2, 'WS');
  await mkproj(path.join(ws, 'frontend'), 'package.json');
  await mkproj(path.join(ws, 'backend'), 'go.mod');
  await mkproj(path.join(ws, 'shared'), 'Cargo.toml');
  await mkproj(path.join(ws, 'infra'), 'Makefile');
  await fs.promises.writeFile(
    path.join(ws, 'team.code-workspace'),
    JSON.stringify({ folders: [{ path: './frontend' }, { path: './backend' }, { path: './shared' }, { path: './infra' }] }),
  );

  // root3: umbrella markers → super-projects (not recursed into).
  // Top-level monorepo: turbo.json at root, no regular marker of its own.
  await fs.promises.mkdir(path.join(root3, 'Monorepo'), { recursive: true });
  await fs.promises.writeFile(path.join(root3, 'Monorepo', 'turbo.json'), '{}');
  await mkproj(path.join(root3, 'Monorepo', 'packages', 'web'), 'package.json');
  await mkproj(path.join(root3, 'Monorepo', 'packages', 'api'), 'go.mod');
  // A collection shelf "Services" with a nested docker-compose super-project + loose projects.
  await fs.promises.mkdir(path.join(root3, 'Services', 'gateway', 'svc-a'), { recursive: true });
  await fs.promises.mkdir(path.join(root3, 'Services', 'gateway', 'svc-b'), { recursive: true });
  await fs.promises.writeFile(path.join(root3, 'Services', 'gateway', 'docker-compose.yml'), 'services: {}');
  for (const p of ['p1', 'p2', 'p3', 'p4']) {
    await mkproj(path.join(root3, 'Services', p), 'package.json');
  }
});

afterAll(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true });
});

function shelf(shelves: Shelf[], name: string): Shelf | undefined {
  return shelves.find(s => s.name === name);
}

describe('scanRoots (filesystem)', () => {
  it('keeps a directory with >ROLLUP_THRESHOLD projects as its own shelf', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const apps = shelf(shelves, 'Apps');
    expect(apps).toBeDefined();
    const names = apps!.items.map(i => (i.kind === 'project' ? i.project.name : i.name)).sort();
    expect(names).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('infers language from markers', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const apps = shelf(shelves, 'Apps')!;
    const a = apps.items.find(i => i.kind === 'project' && i.project.name === 'a');
    expect(a?.kind === 'project' && a.project.primaryLanguage).toBe('ruby');
  });

  it('skips git worktrees (.git as a file)', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const apps = shelf(shelves, 'Apps')!;
    const names = apps.items.map(i => (i.kind === 'project' ? i.project.name : i.name));
    expect(names).not.toContain('wt');
  });

  it('puts standalone top-level projects in the loose Projects shelf', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const loose = shelf(shelves, 'Projects');
    expect(loose).toBeDefined();
    const names = loose!.items.map(i => (i.kind === 'project' ? i.project.name : i.name));
    expect(names).toContain('soloProj');
  });

  it('renders a small category as its own shelf instead of renaming its projects', async () => {
    // `Tiny/` holds one project. It used to be rolled up and the project renamed
    // to "Tiny/only"; now Tiny is a (compact) shelf and the project keeps its name.
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const tiny = shelf(shelves, 'Tiny');
    expect(tiny).toBeDefined();
    const names = tiny!.items.map(i => (i.kind === 'project' ? i.project.name : i.name));
    expect(names).toEqual(['only']);
    const all = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    expect(all.every(p => !p.name.includes('/'))).toBe(true); // no prefix hack anywhere
  });

  it('treats a multi-folder .code-workspace as a bookset shelf', async () => {
    const shelves = await scanRoots({ [root2]: {} }, 3);
    const wsShelf = shelf(shelves, 'WS');
    expect(wsShelf).toBeDefined();
    const projects = wsShelf!.items.filter(i => i.kind === 'project');
    expect(projects).toHaveLength(4);
    // Every sub-project should open via the parent workspace file
    for (const item of projects) {
      if (item.kind === 'project') {
        expect(item.project.workspaceFile).toBe(path.join(root2, 'WS', 'team.code-workspace'));
      }
    }
  });

  it('returns no shelves for an unreadable root', async () => {
    const shelves = await scanRoots({ [path.join(tmp, 'does-not-exist')]: {} }, 3);
    expect(shelves).toEqual([]);
  });

  it('indexes README + manifest blurb into project.searchText', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const all = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    const p = all.find(x => x.name === 'helix-tunnel');
    expect(p).toBeDefined();
    const corpus = (p!.searchText ?? '').toLowerCase();
    expect(corpus).toContain('quic');         // manifest description + README
    expect(corpus).toContain('multiplexing'); // manifest keyword
    expect(corpus).toContain('esperanto');    // README body
  });

  it('indexes .claude/CONTEXT.md for README-less projects (the Cortex case)', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const all = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    const p = all.find(x => x.name === 'cortex');
    expect(p).toBeDefined();
    // No README, no indexable manifest — corpus comes from .claude/CONTEXT.md.
    expect((p!.searchText ?? '').toLowerCase()).toContain('neural');
  });

  it('indexes project source (adjectives kept) and honors .gitignore', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const all = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    const p = all.find(x => x.name === 'synapse');
    expect(p).toBeDefined();
    const corpus = (p!.searchText ?? '').toLowerCase();
    expect(corpus).toContain('neural');             // adjective, from source, not stripped
    expect(corpus).toContain('axon');               // OOV identifier from source
    expect(corpus).not.toContain('confidentialword'); // secret.txt is .gitignore'd
  });

  it('computes tags from the corpus and strips the transient counts', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const all = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    const p = all.find(x => x.name === 'synapse');
    expect(p?.tags && p.tags.length).toBeTruthy();        // tags populated
    expect(p!.tags!.every(t => p!.searchText!.toLowerCase().includes(t))).toBe(true); // tags come from the corpus
    expect(p!.tags).not.toContain('the');                 // denied words never tagged
    expect('tagCounts' in p!).toBe(false);                // transient field stripped before output
    // (TF-IDF demotion of ubiquitous terms is covered by the unit tests; this
    // 10-project fixture is too small for IDF to separate rare generics.)
  });

  it('excludes the project name and language keywords from tags and corpus', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const all = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    const p = all.find(x => x.name === 'widget-forge');
    expect(p).toBeDefined();
    expect(p!.tags).toContain('crucible');           // distinctive domain word survives
    expect(p!.tags).not.toContain('widget');         // own name token — subtracted
    expect(p!.tags).not.toContain('forge');          // own name token — subtracted
    expect(p!.tags).not.toContain('unsigned');       // language keyword — denied
    expect(p!.tags).not.toContain('const');          // language keyword — denied
    expect((p!.searchText ?? '').toLowerCase()).toContain('crucible');
    expect((p!.searchText ?? '').toLowerCase()).not.toContain('unsigned'); // keyword stripped from corpus too
  });

  it('collects git worktrees onto their parent project as a deck, not separate cards', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const all = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    const main = all.find(x => x.name === 'repo-main');
    expect(main).toBeDefined();
    expect(main!.worktrees?.length).toBe(1);
    expect(main!.worktrees![0].gitBranch).toBe('feature-x');
    expect(main!.worktrees![0].path).toBe(wtDir);
    // The worktree must not surface as its own project anywhere.
    expect(all.some(x => x.name === 'wt1')).toBe(false);
    expect(all.some(x => x.path.endsWith(path.join('repo-main-worktrees', 'wt1')))).toBe(false);
  });

  it('recurses into a category whose only marker is a self-referential .code-workspace', async () => {
    // Regression: a lone *.code-workspace matched GLOB_MARKERS and stopped
    // recursion, collapsing six real projects into one opaque card (Games),
    // and hid `vscode/` — ~31 projects invisible across the real library.
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const all = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    const names = all.map(p => p.name);
    expect(names.some(n => n.endsWith('alpha'))).toBe(true);
    expect(names.some(n => n.endsWith('beta'))).toBe(true);
    expect(names.some(n => n.endsWith('gamma'))).toBe(true);
    // The category itself must NOT also appear as a project card.
    expect(all.some(p => p.path === games)).toBe(false);
  });

  it('still treats a real project that ships a workspace file as one card', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const all = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    expect(all.some(p => p.path === solows)).toBe(true);
  });

  // ── Directory classification (git-boundary model) ──

  it('classifies a repo as a project, its parent as a category, and a level above as grouping', async () => {
    expect(await classifyDirectory(path.join(root1, 'soloProj'))).toBe('project');
    expect(await classifyDirectory(path.join(root1, 'Apps'))).toBe('category');
    // root1 holds projects directly, so it is itself a category; root3's
    // Services/gateway sits a level down from a pure grouping.
    expect(await classifyDirectory(path.join(root3, 'Services'))).toBe('category');
  });

  it('treats a repo containing marker-bearing children as ONE project', async () => {
    // The git boundary is the coupling boundary: `core` and `web` are components.
    expect(await classifyDirectory(superRepo)).toBe('project');
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const all = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    expect(all.some(p => p.path === superRepo)).toBe(true);
    expect(all.some(p => p.name === 'core')).toBe(false);
    expect(all.some(p => p.name === 'web')).toBe(false);
  });

  it('lets a .codeshelf declaration override inference', async () => {
    // Structurally this is a category (two independent repos); the declaration
    // makes it one project — the escape hatch for what inference cannot know.
    expect(await classifyDirectory(declaredStore)).toBe('project');
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const all = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    expect(all.some(p => p.path === declaredStore)).toBe(true);
    expect(all.some(p => p.name === 'infrastructure')).toBe(false);
  });

  it('surfaces a project referenced by an external workspace exactly once', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const all = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    const hits = all.filter(p => p.path === sharedProj);
    expect(hits).toHaveLength(1);
    // and it is kept at its real home (the Gems shelf), not in the workspace bookset
    const gems = shelf(shelves, 'Gems');
    expect(gems!.items.some(i => i.kind === 'project' && i.project.path === sharedProj)).toBe(true);
  });

  // ── Umbrella markers → super-projects ──

  it('treats a top-level umbrella-marked dir as a single super-project, not a shelf', async () => {
    const shelves = await scanRoots({ [root3]: {} }, 3);
    // Monorepo has turbo.json but no regular marker → one super-project card,
    // NOT a "Monorepo" shelf, and its packages are not surfaced separately.
    expect(shelf(shelves, 'Monorepo')).toBeUndefined();
    const allProjects = shelves.flatMap(s => s.items).flatMap(i => i.kind === 'project' ? [i.project] : i.projects);
    const mono = allProjects.find(p => p.name === 'Monorepo');
    expect(mono).toBeDefined();
    expect(mono!.markers).toContain('turbo.json');
    expect(allProjects.some(p => p.name === 'web' || p.name === 'api')).toBe(false);
  });

  it('treats a nested umbrella-marked dir as a super-project inside its shelf', async () => {
    const shelves = await scanRoots({ [root3]: {} }, 3);
    const services = shelf(shelves, 'Services');
    expect(services).toBeDefined();
    const names = services!.items.map(i => (i.kind === 'project' ? i.project.name : i.name));
    // gateway (docker-compose.yml) is one super-project card; its svc-* children
    // are not recursed into; the four loose projects sit alongside it.
    expect(names).toContain('gateway');
    expect(names).toEqual(expect.arrayContaining(['p1', 'p2', 'p3', 'p4']));
    expect(names).not.toContain('svc-a');
    expect(names).not.toContain('svc-b');
    const gateway = services!.items.find(i => i.kind === 'project' && i.project.name === 'gateway');
    expect(gateway?.kind === 'project' && gateway.project.markers).toContain('docker-compose.yml');
  });
});
