import { describe, it, expect } from 'vitest';
import { inferLanguage, rollupItems, rollupShelf, ROLLUP_THRESHOLD } from '../src/services/projectScanner';
import type { ShelfItem, Project } from '../src/shared/types';
import { projectOf } from './support';

// ── Helpers ──

function makeProject(name: string, overrides: Partial<Project> = {}): Project {
  return {
    name,
    path: `/mock/${name}`,
    markers: ['.git'],
    lastModified: Date.now(),
    ...overrides,
  };
}

function projectItem(name: string, overrides: Partial<Project> = {}): ShelfItem {
  return { kind: 'project', project: makeProject(name, overrides) };
}

function booksetItem(name: string, projects: string[]): ShelfItem {
  return {
    kind: 'bookset',
    name,
    path: `/mock/${name}`,
    projects: projects.map(p => makeProject(p)),
  };
}

// ── inferLanguage ──

describe('inferLanguage', () => {
  it('returns undefined for git-only markers', () => {
    expect(inferLanguage(['.git'])).toBeUndefined();
  });

  it('returns the language for a single marker', () => {
    expect(inferLanguage(['package.json'])).toBe('javascript');
    expect(inferLanguage(['Gemfile'])).toBe('ruby');
    expect(inferLanguage(['Cargo.toml'])).toBe('rust');
  });

  it('picks highest-priority language when multiple markers present', () => {
    // rust > javascript in LANGUAGE_PRIORITY
    expect(inferLanguage(['.git', 'Cargo.toml', 'package.json'])).toBe('rust');
  });

  it('handles glob markers (.gemspec)', () => {
    expect(inferLanguage(['*.gemspec'])).toBe('ruby');
  });

  it('handles .sln and .csproj glob markers', () => {
    expect(inferLanguage(['*.sln'])).toBe('csharp');
    expect(inferLanguage(['*.csproj'])).toBe('csharp');
  });

  it('handles .xcodeproj and .xcworkspace glob markers', () => {
    expect(inferLanguage(['*.xcodeproj'])).toBe('swift');
    expect(inferLanguage(['*.xcworkspace'])).toBe('swift');
  });
});

// ── rollupItems ──

describe('rollupItems', () => {
  it('passes through standalone projects unchanged', () => {
    const items = [projectItem('a'), projectItem('b')];
    const result = rollupItems(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(items[0]);
  });

  it('flattens booksets with <= ROLLUP_THRESHOLD projects', () => {
    const items = [booksetItem('small', ['x', 'y'])];
    const result = rollupItems(items);
    expect(result).toHaveLength(2);
    expect(result.every(i => i.kind === 'project')).toBe(true);
    expect(projectOf(result[0]).name).toBe('small/x');
    expect(projectOf(result[1]).name).toBe('small/y');
  });

  it('keeps booksets with > ROLLUP_THRESHOLD projects', () => {
    const names = Array.from({ length: ROLLUP_THRESHOLD + 1 }, (_, i) => `p${i}`);
    const items = [booksetItem('big', names)];
    const result = rollupItems(items);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('bookset');
  });

  it('mixes: flattens small booksets, keeps large ones, passes projects', () => {
    const items: ShelfItem[] = [
      projectItem('solo'),
      booksetItem('small', ['a', 'b']),
      booksetItem('big', ['p0', 'p1', 'p2', 'p3']),
    ];
    const result = rollupItems(items);
    // solo + 2 flattened from 'small' + 1 kept bookset
    expect(result).toHaveLength(4);
    expect(result[0].kind).toBe('project');
    expect(result[1].kind).toBe('project');
    expect(result[2].kind).toBe('project');
    expect(result[3].kind).toBe('bookset');
  });
});

// ── rollupShelf ──

describe('rollupShelf', () => {
  it('absorbs a shelf with <= ROLLUP_THRESHOLD total projects and no metadata', () => {
    const items = [projectItem('a'), projectItem('b')];
    const result = rollupShelf(items, 'MyShelf', false);
    expect(result.keep).toBe(false);
    if (!result.keep) {
      expect(result.looseProjects).toHaveLength(2);
      expect(projectOf(result.looseProjects[0]).name).toBe('MyShelf/a');
    }
  });

  it('keeps a shelf with > ROLLUP_THRESHOLD total projects', () => {
    const items = Array.from({ length: ROLLUP_THRESHOLD + 1 }, (_, i) => projectItem(`p${i}`));
    const result = rollupShelf(items, 'BigShelf', false);
    expect(result.keep).toBe(true);
  });

  it('keeps a shelf with explicit metadata even if small', () => {
    const items = [projectItem('a')];
    const result = rollupShelf(items, 'Configured', true);
    expect(result.keep).toBe(true);
  });

  it('flattens booksets inside before counting total', () => {
    // Bookset with 2 projects → flattened to 2 loose projects
    // Total = 2, which is <= threshold, so shelf gets absorbed
    const items: ShelfItem[] = [booksetItem('sub', ['x', 'y'])];
    const result = rollupShelf(items, 'Wrapper', false);
    expect(result.keep).toBe(false);
    if (!result.keep) {
      expect(result.looseProjects).toHaveLength(2);
      // Name should be: ShelfName/BooksetName/ProjectName
      expect(projectOf(result.looseProjects[0]).name).toBe('Wrapper/sub/x');
    }
  });

  it('keeps shelf when bookset flattening still exceeds threshold', () => {
    // 2 projects + bookset with 2 = 4 total > 3 threshold
    const items: ShelfItem[] = [
      projectItem('a'),
      projectItem('b'),
      booksetItem('sub', ['x', 'y']),
    ];
    const result = rollupShelf(items, 'Mixed', false);
    expect(result.keep).toBe(true);
  });
});
