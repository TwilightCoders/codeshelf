import { describe, it, expect } from 'vitest';
import {
  hashColor, timeAgo,
  collectProjects, flattenBooksets, sortProjects,
  projectMatchesQuery, matchSnippet,
  heatOf, bandOf, groupByAge, AGE_BANDS,
  languageCounts, langKey, NO_LANGUAGE,
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

// ── projectMatchesQuery ──

describe('projectMatchesQuery', () => {
  it('matches on name', () => {
    expect(projectMatchesQuery(makeProject('helix-tunnel'), 'helix')).toBe(true);
  });
  it('matches on the indexed corpus when the name does not', () => {
    const p = makeProject('ht', { searchText: 'QUIC reverse tunnel, esperanto-friendly' });
    expect(projectMatchesQuery(p, 'esperanto')).toBe(true);
    expect(projectMatchesQuery(p, 'quic')).toBe(true);
  });
  it('returns false when neither name nor corpus match', () => {
    expect(projectMatchesQuery(makeProject('ht', { searchText: 'a tunnel' }), 'rails')).toBe(false);
  });
  it('matches everything for an empty query', () => {
    expect(projectMatchesQuery(makeProject('x'), '')).toBe(true);
  });
  it('matches on a keyword tag', () => {
    // Tags are rendered as chips on every card, so they read as a searchable
    // affordance; searching a visible tag used to return nothing.
    const p = makeProject('anne', { tags: ['neuron', 'axon', 'synapse'] });
    expect(projectMatchesQuery(p, 'synapse')).toBe(true);
    expect(projectMatchesQuery(p, 'axon')).toBe(true);
  });
  it('still returns false when a tag does not match either', () => {
    expect(projectMatchesQuery(makeProject('anne', { tags: ['neuron'] }), 'rails')).toBe(false);
  });
});

// ── matchSnippet ──

describe('matchSnippet', () => {
  it('returns an excerpt around the match with trailing ellipsis', () => {
    const text = 'Low-latency reverse tunnel built on QUIC multiplexing across many connections and more text here';
    const s = matchSnippet(text, 'multiplexing', 10)!;
    expect(s).toContain('multiplexing');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(matchSnippet('The QUIC protocol', 'quic')).toContain('QUIC');
  });
  it('returns undefined when there is no match or no text', () => {
    expect(matchSnippet('hello world', 'xyz')).toBeUndefined();
    expect(matchSnippet(undefined, 'x')).toBeUndefined();
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

// ── Heat & age bands ──

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 7);
const daysAgo = (d: number) => NOW - d * DAY;

describe('heatOf', () => {
  it('walks hot → frozen as a project cools', () => {
    expect(heatOf(daysAgo(0), NOW)).toBe('hot');
    expect(heatOf(daysAgo(5), NOW)).toBe('warm');
    expect(heatOf(daysAgo(30), NOW)).toBe('cool');
    expect(heatOf(daysAgo(200), NOW)).toBe('cold');
    expect(heatOf(daysAgo(800), NOW)).toBe('frozen');
  });
  it('is inclusive at the low edge of each band', () => {
    expect(heatOf(daysAgo(2), NOW)).toBe('warm');   // 2 days is no longer hot
    expect(heatOf(daysAgo(14), NOW)).toBe('cool');
    expect(heatOf(daysAgo(365), NOW)).toBe('frozen');
  });
});

describe('bandOf', () => {
  it('places a project in the right stratum', () => {
    expect(bandOf(daysAgo(0), NOW).id).toBe('today');
    expect(bandOf(daysAgo(3), NOW).id).toBe('week');
    expect(bandOf(daysAgo(20), NOW).id).toBe('month');
    expect(bandOf(daysAgo(90), NOW).id).toBe('months');
    expect(bandOf(daysAgo(300), NOW).id).toBe('year');
    expect(bandOf(daysAgo(900), NOW).id).toBe('deep');
  });
  it('always returns a band — the last one is unbounded', () => {
    expect(bandOf(0, NOW).id).toBe('deep');
    expect(AGE_BANDS[AGE_BANDS.length - 1].maxDays).toBe(Infinity);
  });
});

describe('groupByAge', () => {
  const p = (name: string, d: number) => ({ name, lastModified: daysAgo(d) });

  it('groups newest-first and drops empty bands', () => {
    const groups = groupByAge([p('old', 900), p('today', 0), p('week', 3)], NOW);
    expect(groups.map(g => g.band.id)).toEqual(['today', 'week', 'deep']);
  });

  it('sorts within a band, most recent first', () => {
    const groups = groupByAge([p('b', 5), p('a', 2), p('c', 6)], NOW);
    expect(groups[0].projects.map(x => x.name)).toEqual(['a', 'b', 'c']);
  });

  it('keeps every project exactly once', () => {
    const input = [p('a', 0), p('b', 40), p('c', 400), p('d', 4000)];
    const total = groupByAge(input, NOW).reduce((n, g) => n + g.projects.length, 0);
    expect(total).toBe(input.length);
  });
});

// ── Language chips ──

describe('languageCounts', () => {
  const p = (name: string, primaryLanguage?: string) =>
    ({ name, path: `/m/${name}`, markers: [], lastModified: 0, primaryLanguage });

  it('counts by language, most common first', () => {
    const counts = languageCounts([p('a', 'ruby'), p('b', 'go'), p('c', 'ruby'), p('d', 'ruby')]);
    expect(counts).toEqual([{ lang: 'ruby', count: 3 }, { lang: 'go', count: 1 }]);
  });

  it('gives projects with no detected language their own bucket', () => {
    // 68 of ~300 have none, so this cannot be an unfilterable gap.
    const counts = languageCounts([p('a'), p('b'), p('c', 'ruby')]);
    expect(counts.find(c => c.lang === NO_LANGUAGE)?.count).toBe(2);
    expect(langKey(p('a'))).toBe(NO_LANGUAGE);
  });

  it('breaks count ties alphabetically so the order is stable', () => {
    expect(languageCounts([p('a', 'zig'), p('b', 'ada')]).map(c => c.lang)).toEqual(['ada', 'zig']);
  });
});
