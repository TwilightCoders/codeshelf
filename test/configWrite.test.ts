import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { updateItemMeta, addRoot } from '../src/providers/config';
import type { RootsConfig } from '../src/shared/types';

// VS Code hands back configuration values as read-only proxies: deleting a key
// throws. A deeply frozen object reproduces that constraint, where a plain object
// (what the other config tests use) silently lets the bug through.
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

function mockConfig(roots: RootsConfig) {
  const update = vi.fn().mockResolvedValue(undefined);
  const frozen = deepFreeze(structuredClone(roots));
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, fallback?: unknown) => (key === 'roots' ? frozen : fallback),
    update,
    has: () => true,
    inspect: () => undefined,
  } as unknown as vscode.WorkspaceConfiguration);
  const written = (): RootsConfig => update.mock.calls.at(-1)?.[1];
  return { update, written };
}

describe('writing codeshelf.roots against a read-only configuration value', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('un-stars a project (a delete on the config value)', async () => {
    // Regression: this threw inside a real extension host, so a star could be
    // turned on but never off.
    const { written } = mockConfig({ '/r': { shelves: { apps: { projects: { api: { starred: true } } } } } });
    await expect(updateItemMeta('/r', '/r/apps/api', 'project', { starred: false })).resolves.toBeUndefined();
    expect(written()['/r'].shelves?.apps?.projects?.api).toBeUndefined();
  });

  it('un-hides a shelf', async () => {
    const { written } = mockConfig({ '/r': { shelves: { archive: { hidden: true } } } });
    await updateItemMeta('/r', '/r/archive', 'shelf', { hidden: false });
    expect(written()['/r'].shelves?.archive?.hidden).toBeFalsy();
  });

  it('stars a project on a root that already has other metadata', async () => {
    const { written } = mockConfig({ '/r': { label: 'Work', shelves: { gems: { starred: true } } } });
    await updateItemMeta('/r', '/r/apps/api', 'project', { starred: true });
    const r = written()['/r'];
    expect(r.label).toBe('Work');
    expect(r.shelves?.gems?.starred).toBe(true);
    expect(r.shelves?.apps?.projects?.api?.starred).toBe(true);
  });

  it('adds a root', async () => {
    const { written } = mockConfig({ '/existing': {} });
    await expect(addRoot('/new')).resolves.toBe(true);
    expect(Object.keys(written())).toEqual(['/existing', '/new']);
  });

  it('never mutates the value VS Code handed back', async () => {
    const original: RootsConfig = { '/r': { shelves: { apps: { projects: { api: { starred: true } } } } } };
    mockConfig(original);
    await updateItemMeta('/r', '/r/apps/api', 'project', { starred: false });
    expect(original['/r'].shelves?.apps?.projects?.api?.starred).toBe(true);
  });
});
