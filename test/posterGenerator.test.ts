import { describe, it, expect } from 'vitest';
import { extractSvg, buildClaudeArgs, buildChildEnv } from '../src/services/posterGenerator';

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

describe('buildClaudeArgs', () => {
  const args = buildClaudeArgs('draw a poster');

  it('skips user settings and MCP servers', () => {
    // Regression: without these the CLI loads the user's hooks, which keep the
    // process alive after it prints the SVG, so every generation timed out.
    expect(args).toContain('--restricted');
    expect(args).toContain('--strict-mcp-config');
  });

  it('does not write a session transcript per poster', () => {
    expect(args).toContain('--no-session-persistence');
  });

  it('passes the prompt as the -p value', () => {
    expect(args[args.indexOf('-p') + 1]).toBe('draw a poster');
  });

  it('keeps the variadic --allowedTools last so it cannot swallow other flags', () => {
    const i = args.indexOf('--allowedTools');
    expect(i).toBeGreaterThan(-1);
    expect(args.slice(i + 1).every(a => !a.startsWith('--'))).toBe(true);
  });
});

describe('buildChildEnv', () => {
  it('drops the markers a parent Claude Code session leaves behind', () => {
    const env = buildChildEnv({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', HOME: '/h' });
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
  });

  it('keeps everything else, including what auth may depend on', () => {
    const env = buildChildEnv({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', CLAUDE_CONFIG_DIR: '/c' });
    expect(env).toMatchObject({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', CLAUDE_CONFIG_DIR: '/c' });
  });

  it('does not mutate the parent environment', () => {
    const parent = { CLAUDECODE: '1' };
    buildChildEnv(parent);
    expect(parent.CLAUDECODE).toBe('1');
  });
});

// ── The generator against a fake CLI ──
//
// A stand-in executable exercises the real spawn path — stdin handling, output
// capture, cancellation — without the Claude CLI or a network.

import { PosterGenerator, PosterCancelledError } from '../src/services/posterGenerator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach } from 'vitest';

describe('PosterGenerator (fake CLI)', () => {
  let dir: string;
  const project = () => ({ name: 'demo', path: path.join(dir, 'proj'), markers: ['package.json'], lastModified: 0 });

  function fakeCli(body: string): string {
    const bin = path.join(dir, 'fake-claude');
    fs.writeFileSync(bin, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return bin;
  }
  function generator(bin: string, onPoster: (r: { projectPath: string; posterUri: string }) => void = () => {}) {
    const ctx = { globalStorageUri: { fsPath: path.join(dir, 'storage') } } as unknown as import('vscode').ExtensionContext;
    return new PosterGenerator(ctx, { bestMethod: 'claude-cli', available: ['claude-cli'], claudeCliPath: bin }, onPoster);
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeshelf-poster-'));
    fs.mkdirSync(path.join(dir, 'proj'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('closes stdin, so a CLI that reads it cannot hang the run', async () => {
    // With an open pipe `head` would block forever and the test would time out.
    const bin = fakeCli(`head -c1 >/dev/null\necho '<svg width="400" height="240"></svg>'`);
    let delivered = '';
    await generator(bin, r => { delivered = r.posterUri; }).generateOne(project());
    expect(fs.readFileSync(delivered, 'utf8')).toContain('<svg');
  }, 10_000);

  it('extracts the SVG from chatter around it', async () => {
    const bin = fakeCli(`echo 'Here you go:'\necho '<svg><rect/></svg>'\necho 'Enjoy!'`);
    let delivered = '';
    await generator(bin, r => { delivered = r.posterUri; }).generateOne(project());
    expect(fs.readFileSync(delivered, 'utf8')).toBe('<svg><rect/></svg>');
  });

  it('reports non-SVG output as a failure', async () => {
    const bin = fakeCli(`echo 'I cannot do that'`);
    await expect(generator(bin).generateOne(project())).rejects.toThrow(/non-SVG/);
  });

  it('reports a CLI that exits non-zero, with its stderr', async () => {
    const bin = fakeCli(`echo 'boom' >&2\nexit 3`);
    await expect(generator(bin).generateOne(project())).rejects.toThrow(/exited 3.*boom/);
  });

  it('treats a user cancel as a cancellation, not a failure', async () => {
    const bin = fakeCli(`sleep 30`);
    const gen = generator(bin);
    const run = gen.generateOne(project());
    await new Promise(r => setTimeout(r, 200));
    expect(gen.isGenerating).toBe(true);
    gen.cancel();
    await expect(run).rejects.toBeInstanceOf(PosterCancelledError);
    expect(gen.isGenerating).toBe(false);
  }, 10_000);

  it('writes nothing when a run is cancelled', async () => {
    const gen = generator(fakeCli(`sleep 30`));
    const run = gen.generateOne(project());
    await new Promise(r => setTimeout(r, 200));
    gen.cancel();
    await run.catch(() => {});
    expect(gen.getCachedPosterPath(project())).toBeUndefined();
  }, 10_000);
});
