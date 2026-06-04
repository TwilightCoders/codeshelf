import { describe, it, expect } from 'vitest';
import { pickManifest, extractManifestBlurb, cleanDocText, assembleSearchText, extractVocabulary, documentFrequencies, tfidfTags } from '../src/services/projectIndex';

describe('pickManifest', () => {
  it('prefers package.json over other manifests', () => {
    expect(pickManifest(['Cargo.toml', 'package.json', 'README.md'])).toBe('package.json');
  });
  it('falls back to a *.gemspec', () => {
    expect(pickManifest(['glossary.gemspec', 'Gemfile'])).toBe('glossary.gemspec');
  });
  it('returns undefined when no known manifest', () => {
    expect(pickManifest(['README.md', 'Makefile'])).toBeUndefined();
  });
});

describe('extractManifestBlurb', () => {
  it('pulls description + keywords from package.json', () => {
    const c = JSON.stringify({ description: 'A QUIC tunnel', keywords: ['quic', 'tunnel'], name: 'x' });
    expect(extractManifestBlurb('package.json', c)).toBe('A QUIC tunnel quic tunnel');
  });
  it('pulls description from Cargo.toml', () => {
    const c = '[package]\nname = "x"\ndescription = "fast rust thing"\n';
    expect(extractManifestBlurb('Cargo.toml', c)).toBe('fast rust thing');
  });
  it('pulls summary + description from a gemspec', () => {
    const c = 'Gem::Specification.new do |spec|\n  spec.summary = "tiny gem"\n  spec.description = "does tiny things"\nend';
    expect(extractManifestBlurb('glossary.gemspec', c)).toBe('tiny gem does tiny things');
  });
  it('returns empty string on malformed JSON', () => {
    expect(extractManifestBlurb('package.json', '{not json')).toBe('');
  });
});

describe('cleanDocText', () => {
  it('strips fenced code, comments, and markdown syntax but keeps words and hyphens', () => {
    const md = '# Title\n\n<!-- hidden -->\n\nA **bold** `inline` and a [link](http://x) plus fd-leak.\n\n```js\ncode()\n```\n';
    const out = cleanDocText(md);
    expect(out).toContain('Title');
    expect(out).toContain('bold');
    expect(out).toContain('link');        // link text kept
    expect(out).toContain('fd-leak');     // inline hyphen preserved
    expect(out).not.toContain('hidden');  // comment stripped
    expect(out).not.toContain('code()');  // fenced code stripped
    expect(out).not.toContain('#');
    expect(out).not.toContain('`');
  });
});

describe('assembleSearchText', () => {
  it('joins blurb and cleaned readme', () => {
    const out = assembleSearchText('a tunnel', '# Helix\n\nReverse tunnel with QUIC.');
    expect(out).toContain('a tunnel');
    expect(out).toContain('Helix');
    expect(out).toContain('QUIC');
  });
  it('caps total length', () => {
    const out = assembleSearchText('', 'x'.repeat(5000));
    expect(out.length).toBeLessThanOrEqual(3000);
  });
  it('returns empty when there is nothing to index', () => {
    expect(assembleSearchText('', '')).toBe('');
  });
});

describe('extractVocabulary', () => {
  const none = new Set<string>();

  it('splits camelCase/PascalCase and lowercases', () => {
    expect(extractVocabulary('MemoryNeuron axonCount HTTPServer', none))
      .toEqual(expect.arrayContaining(['memory', 'neuron', 'axon', 'count', 'http', 'server']));
  });

  it('subtracts the denylist (non-nouns) but keeps the rest', () => {
    const deny = new Set(['the', 'running', 'quickly']);
    expect(extractVocabulary('the neural network running quickly', deny))
      .toEqual(['neural', 'network']);
  });

  it('drops short tokens and pure numbers', () => {
    expect(extractVocabulary('a ab abc 404 notfound', none)).toEqual(['abc', 'notfound']);
  });

  it('dedupes', () => {
    expect(extractVocabulary('cat cat dog cat', none)).toEqual(['cat', 'dog']);
  });

  it('respects the cap', () => {
    expect(extractVocabulary('alpha bravo charlie delta echo', none, 2)).toHaveLength(2);
  });

  it('is frequency-ranked (most common first)', () => {
    expect(extractVocabulary('dog dog dog cat cat bird', none, 3)).toEqual(['dog', 'cat', 'bird']);
  });
});

describe('TF-IDF tags', () => {
  it('documentFrequencies counts how many projects contain each term', () => {
    const df = documentFrequencies([{ a: 5, b: 1 }, { a: 3, c: 2 }, { a: 1, d: 4 }]);
    expect(df.get('a')).toBe(3);
    expect(df.get('b')).toBe(1);
    expect(df.get('d')).toBe(1);
  });

  it('drops ubiquitous terms (in every project) and promotes rare ones', () => {
    const df = documentFrequencies([{ common: 9, rare: 2 }, { common: 9, x: 1 }, { common: 9, y: 1 }]);
    const tags = tfidfTags({ common: 9, rare: 2 }, df, 3, 5);
    expect(tags).toContain('rare');        // df=1 → high idf
    expect(tags).not.toContain('common');  // df=N → idf=0 → dropped
  });

  it('falls back to raw frequency for a single project', () => {
    const counts = { alpha: 5, beta: 2, gamma: 1 };
    expect(tfidfTags(counts, documentFrequencies([counts]), 1, 2)).toEqual(['alpha', 'beta']);
  });

  it('respects topN', () => {
    const counts = { a: 5, b: 4, c: 3, d: 2 };
    expect(tfidfTags(counts, documentFrequencies([counts, { e: 1 }]), 2, 2)).toHaveLength(2);
  });
});
