import { describe, it, expect } from 'vitest';
import { inferLanguage } from '../src/services/projectScanner';

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
