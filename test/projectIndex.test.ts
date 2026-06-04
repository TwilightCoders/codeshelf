import { describe, it, expect } from 'vitest';
import { pickManifest, extractManifestBlurb, cleanDocText, assembleSearchText } from '../src/services/projectIndex';

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
    expect(out.length).toBeLessThanOrEqual(2000);
  });
  it('returns empty when there is nothing to index', () => {
    expect(assembleSearchText('', '')).toBe('');
  });
});
