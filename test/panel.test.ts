import { describe, it, expect } from 'vitest';
import { computeDiff, collectProjectPaths } from '../src/providers/codeshelfPanel';
import { transformSvg, sanitizeSvg } from '../src/services/svgEmbed';
import { applyItemMeta } from '../src/providers/config';
import type { Shelf, RootsConfig } from '../src/shared/types';

// ── Helpers ──

function makeShelf(name: string, projectNames: string[]): Shelf {
  return {
    name,
    path: `/root/${name}`,
    rootLabel: 'Root',
    rootPath: '/root',
    items: projectNames.map(n => ({
      kind: 'project' as const,
      project: { name: n, path: `/root/${name}/${n}`, markers: ['.git'], lastModified: Date.now() },
    })),
  };
}

// ── collectProjectPaths ──

describe('collectProjectPaths', () => {
  it('collects paths from projects', () => {
    const shelves = [makeShelf('Apps', ['foo', 'bar'])];
    const paths = collectProjectPaths(shelves);
    expect(paths.size).toBe(2);
    expect(paths.has('/root/Apps/foo')).toBe(true);
    expect(paths.has('/root/Apps/bar')).toBe(true);
  });

  it('collects paths from booksets', () => {
    const shelves: Shelf[] = [{
      name: 'Mixed', path: '/root/Mixed', rootLabel: 'Root', rootPath: '/root',
      items: [
        { kind: 'bookset', name: 'sub', path: '/root/Mixed/sub', projects: [
          { name: 'a', path: '/root/Mixed/sub/a', markers: ['.git'], lastModified: Date.now() },
        ]},
      ],
    }];
    const paths = collectProjectPaths(shelves);
    expect(paths.has('/root/Mixed/sub/a')).toBe(true);
  });

  it('returns empty set for empty shelves', () => {
    expect(collectProjectPaths([]).size).toBe(0);
  });
});

// ── computeDiff ──

describe('computeDiff', () => {
  it('detects no change when shelves are identical', () => {
    const shelves = [makeShelf('Apps', ['foo'])];
    const diff = computeDiff(shelves, shelves);
    expect(diff.changed).toBe(false);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
  });

  it('detects added projects', () => {
    const old = [makeShelf('Apps', ['foo'])];
    const next = [makeShelf('Apps', ['foo', 'bar'])];
    const diff = computeDiff(old, next);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(0);
    expect(diff.changed).toBe(true);
  });

  it('returns addedPaths for new projects', () => {
    const old = [makeShelf('Apps', ['foo'])];
    const next = [makeShelf('Apps', ['foo', 'bar'])];
    const diff = computeDiff(old, next);
    expect(diff.addedPaths).toEqual(['/root/Apps/bar']);
  });

  it('returns empty addedPaths when nothing added', () => {
    const old = [makeShelf('Apps', ['foo', 'bar'])];
    const next = [makeShelf('Apps', ['foo'])];
    const diff = computeDiff(old, next);
    expect(diff.addedPaths).toEqual([]);
  });

  it('detects removed projects', () => {
    const old = [makeShelf('Apps', ['foo', 'bar'])];
    const next = [makeShelf('Apps', ['foo'])];
    const diff = computeDiff(old, next);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(1);
    expect(diff.changed).toBe(true);
  });

  it('detects both added and removed', () => {
    const old = [makeShelf('Apps', ['foo', 'bar'])];
    const next = [makeShelf('Apps', ['foo', 'baz'])];
    const diff = computeDiff(old, next);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.changed).toBe(true);
    expect(diff.addedPaths).toEqual(['/root/Apps/baz']);
  });

  it('works across multiple shelves', () => {
    const old = [makeShelf('A', ['x']), makeShelf('B', ['y'])];
    const next = [makeShelf('A', ['x']), makeShelf('C', ['z'])];
    const diff = computeDiff(old, next);
    expect(diff.added).toBe(1);  // z
    expect(diff.removed).toBe(1); // y
    expect(diff.addedPaths).toEqual(['/root/C/z']);
  });
});

// ── transformSvg ──

describe('transformSvg', () => {
  it('returns undefined for non-SVG content', () => {
    expect(transformSvg('<div>not svg</div>')).toBeUndefined();
    expect(transformSvg('')).toBeUndefined();
  });

  it('strips width and height attributes', () => {
    const input = '<svg width="400" height="240"><rect/></svg>';
    const result = transformSvg(input)!;
    expect(result).not.toContain('width="400"');
    expect(result).not.toContain('height="240"');
  });

  it('adds viewBox from width/height when missing', () => {
    const input = '<svg width="400" height="240"><rect/></svg>';
    const result = transformSvg(input)!;
    expect(result).toContain('viewBox="0 0 400 240"');
  });

  it('preserves existing viewBox', () => {
    const input = '<svg viewBox="0 0 100 100" width="400" height="240"><rect/></svg>';
    const result = transformSvg(input)!;
    expect(result).toContain('viewBox="0 0 100 100"');
    expect(result).not.toContain('viewBox="0 0 400 240"');
  });

  it('adds preserveAspectRatio when missing', () => {
    const input = '<svg viewBox="0 0 100 100"><rect/></svg>';
    const result = transformSvg(input)!;
    expect(result).toContain('preserveAspectRatio="xMidYMid slice"');
  });

  it('preserves existing preserveAspectRatio', () => {
    const input = '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><rect/></svg>';
    const result = transformSvg(input)!;
    expect(result).toContain('preserveAspectRatio="none"');
    expect(result).not.toContain('xMidYMid slice');
  });

  it('preserves SVG content after the opening tag', () => {
    const input = '<svg width="400" height="240"><rect x="0" y="0"/><text>hello</text></svg>';
    const result = transformSvg(input)!;
    expect(result).toContain('<rect x="0" y="0"/>');
    expect(result).toContain('<text>hello</text>');
  });
});

// ── sanitizeSvg ──

describe('sanitizeSvg', () => {
  it('strips <script> blocks', () => {
    const input = '<svg><script>alert(1)</script><rect/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert(1)');
    expect(result).toContain('<rect/>');
  });

  it('strips self-closing <script/> tags', () => {
    const input = '<svg><script src="evil.js"/><rect/></svg>';
    expect(sanitizeSvg(input)).not.toContain('<script');
  });

  it('strips inline event-handler attributes', () => {
    const input = '<svg onload="steal()"><rect onclick=\'go()\'/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('onload');
    expect(result).not.toContain('onclick');
  });

  it('strips <foreignObject> content', () => {
    const input = '<svg><foreignObject><body onload="x()"/></foreignObject><rect/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('foreignObject');
    expect(result).toContain('<rect/>');
  });

  it('neutralizes javascript: URLs in href', () => {
    const input = '<svg><a href="javascript:alert(1)"><rect/></a></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('javascript:');
    expect(result).toContain('href="#"');
  });

  it('leaves benign SVG untouched', () => {
    const input = '<svg viewBox="0 0 10 10"><rect x="1" y="1" fill="#fff"/></svg>';
    expect(sanitizeSvg(input)).toBe(input);
  });
});

// ── transformSvg sanitizes too ──

describe('transformSvg sanitization', () => {
  it('removes scripts while normalizing the svg tag', () => {
    const input = '<svg width="400" height="240"><script>evil()</script><rect/></svg>';
    const result = transformSvg(input)!;
    expect(result).not.toContain('<script');
    expect(result).toContain('viewBox="0 0 400 240"');
  });
});

// ── applyItemMeta ──

describe('applyItemMeta', () => {
  it('stars a shelf (direct child of root)', () => {
    const roots: RootsConfig = { '/root': {} };
    applyItemMeta(roots, '/root', '/root/Gems', 'shelf', { starred: true });
    expect(roots['/root'].shelves?.['Gems']?.starred).toBe(true);
  });

  it('stars a collapsed/nested shelf by its basename (not as a project)', () => {
    const roots: RootsConfig = { '/root': {} };
    applyItemMeta(roots, '/root', '/root/Plugins/Editor', 'shelf', { starred: true });
    // Keyed by basename — where resolveShelfMeta looks — NOT as Plugins.projects.*
    expect(roots['/root'].shelves?.['Editor']?.starred).toBe(true);
    expect(roots['/root'].shelves?.['Plugins']).toBeUndefined();
  });

  it('stars a project (deeper path)', () => {
    const roots: RootsConfig = { '/root': {} };
    applyItemMeta(roots, '/root', '/root/Gems/glossary', 'project', { starred: true });
    expect(roots['/root'].shelves?.['Gems']?.projects?.['glossary']?.starred).toBe(true);
  });

  it('hides a shelf', () => {
    const roots: RootsConfig = { '/root': {} };
    applyItemMeta(roots, '/root', '/root/Archive', 'shelf', { hidden: true });
    expect(roots['/root'].shelves?.['Archive']?.hidden).toBe(true);
  });

  it('unstarring a shelf removes the starred key but keeps the entry', () => {
    const roots: RootsConfig = { '/root': { shelves: { Gems: { starred: true } } } };
    applyItemMeta(roots, '/root', '/root/Gems', 'shelf', { starred: false });
    expect(roots['/root'].shelves?.['Gems']).toEqual({});
  });

  it('unstarring removes the starred key (falsy cleanup)', () => {
    const roots: RootsConfig = { '/root': { shelves: { Gems: { projects: { glossary: { starred: true } } } } } };
    applyItemMeta(roots, '/root', '/root/Gems/glossary', 'project', { starred: false });
    // Project entry should be cleaned up entirely
    expect(roots['/root'].shelves?.['Gems']?.projects?.['glossary']).toBeUndefined();
  });

  it('cleans up empty project entries', () => {
    const roots: RootsConfig = { '/root': { shelves: { Gems: { projects: { glossary: { starred: true } } } } } };
    applyItemMeta(roots, '/root', '/root/Gems/glossary', 'project', { starred: false });
    // projects should be gone, shelf should be gone, shelves should be gone
    expect(roots['/root'].shelves).toBeUndefined();
  });

  it('keeps empty shelf entries (prevents absorption)', () => {
    const roots: RootsConfig = { '/root': { shelves: { Gems: { hidden: true } } } };
    applyItemMeta(roots, '/root', '/root/Gems', 'shelf', { hidden: false });
    // Shelf entry should remain (empty but present)
    expect(roots['/root'].shelves?.['Gems']).toEqual({});
  });

  it('handles tilde-expanded root paths', () => {
    const roots: RootsConfig = { '~/Projects': {} };
    applyItemMeta(roots, '/Users/alex/Projects', '/Users/alex/Projects/Apps', 'shelf', { starred: true }, '/Users/alex');
    expect(roots['~/Projects'].shelves?.['Apps']?.starred).toBe(true);
  });

  it('does nothing when root is not found', () => {
    const roots: RootsConfig = { '/root': {} };
    const before = JSON.stringify(roots);
    applyItemMeta(roots, '/nonexistent', '/nonexistent/Foo', 'shelf', { starred: true });
    expect(JSON.stringify(roots)).toBe(before);
  });

  it('can set multiple updates at once', () => {
    const roots: RootsConfig = { '/root': {} };
    applyItemMeta(roots, '/root', '/root/Gems', 'shelf', { starred: true, hidden: true });
    expect(roots['/root'].shelves?.['Gems']?.starred).toBe(true);
    expect(roots['/root'].shelves?.['Gems']?.hidden).toBe(true);
  });
});
