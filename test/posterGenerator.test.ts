import { describe, it, expect } from 'vitest';
import { extractSvg } from '../src/services/posterGenerator';

describe('extractSvg', () => {
  it('returns a clean SVG document unchanged', () => {
    const svg = '<svg viewBox="0 0 400 240"><rect/></svg>';
    expect(extractSvg(svg)).toBe(svg);
  });

  it('trims surrounding whitespace', () => {
    const svg = '<svg><rect/></svg>';
    expect(extractSvg(`\n  ${svg}\n`)).toBe(svg);
  });

  it('pulls the SVG out of leading chatter', () => {
    const out = "Sure! Here's your poster:\n<svg><rect/></svg>";
    expect(extractSvg(out)).toBe('<svg><rect/></svg>');
  });

  it('pulls the SVG out of trailing prose', () => {
    const out = '<svg><rect/></svg>\n\nLet me know if you want changes!';
    expect(extractSvg(out)).toBe('<svg><rect/></svg>');
  });

  it('handles multi-line SVG content', () => {
    const svg = '<svg>\n  <rect x="0"/>\n  <text>hi</text>\n</svg>';
    expect(extractSvg(svg)).toBe(svg);
  });

  it('returns undefined when there is no SVG', () => {
    expect(extractSvg('I cannot generate that.')).toBeUndefined();
    expect(extractSvg('')).toBeUndefined();
  });

  it('returns undefined for an unterminated SVG', () => {
    expect(extractSvg('<svg><rect/>')).toBeUndefined();
  });
});
