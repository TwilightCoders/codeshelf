import { describe, it, expect } from 'vitest';
import {
  hashColor, timeAgo,
  collectProjects, flattenBooksets, sortProjects,
} from '../src/webview/components/pure';
import type { ShelfItem, Project } from '../src/shared/types';
import { projectOf } from './support';

function makeProject(name: string, overrides: Partial<Project> = {}): Project {
  return {
    name,
    path: `/mock/${name}`,
    markers: ['.git'],
    lastModified: Date.now(),
    ...overrides,
  };
}

// ── hashColor ──

describe('hashColor', () => {
  it('returns an hsl string', () => {
    const result = hashColor('test');
    expect(result).toMatch(/^hsl\(\d+, 40%, 35%\)$/);
  });

  it('returns consistent results for the same input', () => {
    expect(hashColor('glossary')).toBe(hashColor('glossary'));
  });

  it('returns different results for different inputs', () => {
    expect(hashColor('foo')).not.toBe(hashColor('bar'));
  });
});

// ── timeAgo ──

describe('timeAgo', () => {
  it('returns "just now" for recent timestamps', () => {
    expect(timeAgo(Date.now() - 30_000)).toBe('just now');
  });

  it('returns minutes', () => {
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe('5m ago');
  });

  it('returns hours', () => {
    expect(timeAgo(Date.now() - 3 * 3_600_000)).toBe('3h ago');
  });

  it('returns days', () => {
    expect(timeAgo(Date.now() - 7 * 86_400_000)).toBe('7d ago');
  });

  it('returns months', () => {
    expect(timeAgo(Date.now() - 90 * 86_400_000)).toBe('3mo ago');
  });

  it('returns years', () => {
    expect(timeAgo(Date.now() - 400 * 86_400_000)).toBe('1y ago');
  });
});

// ── collectProjects ──

describe('collectProjects', () => {
  it('extracts projects from flat list', () => {
    const items: ShelfItem[] = [
      { kind: 'project', project: makeProject('a') },
      { kind: 'project', project: makeProject('b') },
    ];
    const result = collectProjects(items);
    expect(result).toHaveLength(2);
    expect(result.map(p => p.name)).toEqual(['a', 'b']);
  });

  it('extracts projects from booksets', () => {
    const items: ShelfItem[] = [
      { kind: 'bookset', name: 'set', path: '/set', projects: [makeProject('x'), makeProject('y')] },
    ];
    const result = collectProjects(items);
    expect(result).toHaveLength(2);
  });

  it('mixes projects and booksets', () => {
    const items: ShelfItem[] = [
      { kind: 'project', project: makeProject('solo') },
      { kind: 'bookset', name: 'set', path: '/set', projects: [makeProject('x')] },
    ];
    expect(collectProjects(items)).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(collectProjects([])).toEqual([]);
  });
});

// ── flattenBooksets ──

describe('flattenBooksets', () => {
  it('passes projects through unchanged', () => {
    const items: ShelfItem[] = [{ kind: 'project', project: makeProject('a') }];
    const result = flattenBooksets(items);
    expect(result).toHaveLength(1);
    expect(projectOf(result[0]).name).toBe('a');
  });

  it('flattens booksets with prefixed names', () => {
    const items: ShelfItem[] = [
      { kind: 'bookset', name: 'Games', path: '/gd', projects: [makeProject('Starfield'), makeProject('Tetris')] },
    ];
    const result = flattenBooksets(items);
    expect(result).toHaveLength(2);
    expect(result.every(i => i.kind === 'project')).toBe(true);
    expect(projectOf(result[0]).name).toBe('Games/Starfield');
    expect(projectOf(result[1]).name).toBe('Games/Tetris');
  });
});

// ── sortProjects ──

describe('sortProjects', () => {
  it('puts starred projects first', () => {
    const projects = [
      makeProject('unstarred', { lastModified: Date.now() }),
      makeProject('starred', { starred: true, lastModified: Date.now() - 999999 }),
    ];
    const sorted = sortProjects(projects);
    expect(sorted[0].name).toBe('starred');
  });

  it('sorts by lastModified descending within same star status', () => {
    const now = Date.now();
    const projects = [
      makeProject('old', { lastModified: now - 100000 }),
      makeProject('new', { lastModified: now }),
      makeProject('mid', { lastModified: now - 50000 }),
    ];
    const sorted = sortProjects(projects);
    expect(sorted.map(p => p.name)).toEqual(['new', 'mid', 'old']);
  });

  it('does not mutate the input array', () => {
    const projects = [makeProject('b'), makeProject('a')];
    const original = [...projects];
    sortProjects(projects);
    expect(projects).toEqual(original);
  });

  it('sorts by name when sortBy is "name"', () => {
    const projects = [makeProject('charlie'), makeProject('alpha'), makeProject('bravo')];
    expect(sortProjects(projects, 'name').map(p => p.name)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('sorts by language when sortBy is "language"', () => {
    const projects = [
      makeProject('x', { primaryLanguage: 'ruby' }),
      makeProject('y', { primaryLanguage: 'go' }),
      makeProject('z', { primaryLanguage: 'python' }),
    ];
    expect(sortProjects(projects, 'language').map(p => p.primaryLanguage)).toEqual(['go', 'python', 'ruby']);
  });

  it('keeps starred first regardless of sort mode', () => {
    const projects = [
      makeProject('zeta'),
      makeProject('alpha', { starred: true }),
    ];
    expect(sortProjects(projects, 'name')[0].name).toBe('alpha');
  });
});
