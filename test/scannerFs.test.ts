import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanRoots } from '../src/services/projectScanner';
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

  it('absorbs small/single-child dirs into the loose Projects shelf', async () => {
    const shelves = await scanRoots({ [root1]: {} }, 3);
    const loose = shelf(shelves, 'Projects');
    expect(loose).toBeDefined();
    const names = loose!.items.map(i => (i.kind === 'project' ? i.project.name : i.name));
    expect(names).toContain('soloProj');
    expect(names).toContain('Tiny/only'); // single-child collapse prefixes the name
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
