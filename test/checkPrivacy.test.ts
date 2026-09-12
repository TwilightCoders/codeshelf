import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain ESM script without type declarations
import { machineNeedles, findLeaks } from '../scripts/check-privacy.mjs';

const needles = machineNeedles({ home: '/Users/alex', user: 'alex', email: 'alex@example.com' });

describe('check-privacy', () => {
  it('flags the build machine home directory', () => {
    expect(findLeaks('see /Users/alex/code/app', needles)).toContain('home directory');
  });

  it('flags the git email', () => {
    expect(findLeaks('author alex@example.com', needles)).toContain('git email');
  });

  it("flags anyone's absolute home path, not just the packager's", () => {
    expect(findLeaks('cwd was /home/sam/work/x', needles)).toContain('an absolute home-directory path');
  });

  it('passes ordinary text, including tilde paths used as examples', () => {
    expect(findLeaks('Add a root such as ~/code or ~/Developer.', needles)).toEqual([]);
  });

  it('does not treat a bare word matching the username as a leak', () => {
    expect(findLeaks('alex is a common word in some prose', needles)).toEqual([]);
  });
});
