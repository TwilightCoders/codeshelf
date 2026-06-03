import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanRoots } from '../src/services/projectScanner';
import { applyItemMeta } from '../src/providers/config';
import type { RootsConfig, Shelf } from '../src/shared/types';

// Investigation: does starring a *collection* (shelf) round-trip — i.e. does the
// metadata written by applyItemMeta resolve back to shelf.starred on the next
// scan? Covers a top-level shelf, a collapsed/nested shelf, and the loose
// "Projects" shelf (whose path === the root).

let root: string;
let tmp: string;

async function mkproj(dir: string) {
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, 'package.json'), '{}');
}

beforeAll(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codeshelf-star-'));
  root = path.join(tmp, 'root');
  // Top-level shelf with 4 projects (> rollup threshold → stays a shelf).
  for (const n of ['a', 'b', 'c', 'd']) await mkproj(path.join(root, 'Gems', n));
  // Single-child collapse → shelf "Plugins/Editor" at a nested path.
  for (const n of ['x', 'y', 'z', 'w']) await mkproj(path.join(root, 'Plugins', 'Editor', n));
  // A couple of loose top-level projects → a "Projects" shelf whose path === root.
  await mkproj(path.join(root, 'looseOne'));
  await mkproj(path.join(root, 'looseTwo'));
});

afterAll(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true });
});

function shelfNamed(shelves: Shelf[], name: string): Shelf | undefined {
  return shelves.find(s => s.name === name);
}

describe('star round-trip for collections', () => {
  it('top-level shelf: star ON then OFF both reflect', async () => {
    const config: RootsConfig = { [root]: {} };
    expect(await gemsStarred(config)).toBe(false);
    applyItemMeta(config, root, path.join(root, 'Gems'), 'shelf', { starred: true });
    expect(await gemsStarred(config)).toBe(true);
    applyItemMeta(config, root, path.join(root, 'Gems'), 'shelf', { starred: false });
    expect(await gemsStarred(config)).toBe(false);
  });

  it('top-level shelf: hide ON then OFF both reflect', async () => {
    const config: RootsConfig = { [root]: {} };
    const hidden = async () => !!shelfNamed(await scanRoots(config, 3), 'Gems')?.hidden;
    applyItemMeta(config, root, path.join(root, 'Gems'), 'shelf', { hidden: true });
    expect(await hidden()).toBe(true);
    applyItemMeta(config, root, path.join(root, 'Gems'), 'shelf', { hidden: false });
    expect(await hidden()).toBe(false);
  });

  // The synthetic loose "Projects" shelf has path === root, which used to be
  // keyed where the scanner never read it back — regression guard.
  it('loose "Projects" shelf: star ON then OFF both reflect', async () => {
    const config: RootsConfig = { [root]: {} };
    const projectsShelf = shelfNamed(await scanRoots(config, 3), 'Projects');
    expect(projectsShelf).toBeDefined();
    applyItemMeta(config, root, projectsShelf!.path, 'shelf', { starred: true });
    expect(shelfNamed(await scanRoots(config, 3), 'Projects')?.starred).toBe(true);
    applyItemMeta(config, root, projectsShelf!.path, 'shelf', { starred: false });
    expect(shelfNamed(await scanRoots(config, 3), 'Projects')?.starred).toBeFalsy();
  });

  it('loose "Projects" shelf: hide reflects', async () => {
    const config: RootsConfig = { [root]: {} };
    const projectsShelf = shelfNamed(await scanRoots(config, 3), 'Projects');
    applyItemMeta(config, root, projectsShelf!.path, 'shelf', { hidden: true });
    expect(shelfNamed(await scanRoots(config, 3), 'Projects')?.hidden).toBe(true);
  });
});

// helpers
async function gemsStarred(config: RootsConfig): Promise<boolean> {
  const s = shelfNamed(await scanRoots(config, 3), 'Gems');
  return !!s?.starred;
}
