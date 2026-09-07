import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Page } from 'puppeteer-core';
import { launchBrowser, closeBrowser, openDevPage, screenshot } from './harness';

let page: Page;

beforeAll(async () => {
  await launchBrowser();
});

afterAll(async () => {
  await closeBrowser();
});

beforeEach(async () => {
  if (page && !page.isClosed()) await page.close();
  page = await openDevPage();
});

// ── Rendering ──

describe('initial render', () => {
  it('renders project cards', async () => {
    const cards = await page.$$('.project-card');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('renders one card per visible (non-hidden) project in the mock data', async () => {
    const expected = await page.evaluate(() => {
      const shelves = window.__mockHost?.getShelves() ?? [];
      let n = 0;
      for (const shelf of shelves) {
        if (shelf.hidden) continue;
        for (const item of shelf.items) {
          n += item.kind === 'project' ? 1 : item.projects.length;
        }
      }
      return n;
    });
    expect(expected).toBeGreaterThan(0);
    const cards = await page.$$('.project-card');
    expect(cards.length).toBe(expected);
  });

  it('renders shelf titles', async () => {
    const titles = await page.$$eval('.shelf-row-title', els =>
      els.map(e => e.textContent?.trim())
    );
    expect(titles.some(t => t?.includes('Gems'))).toBe(true);
    expect(titles.some(t => t?.includes('Apps'))).toBe(true);
    expect(titles.some(t => t?.includes('vscode'))).toBe(true);
  });

  it('renders root group headers', async () => {
    const roots = await page.$$eval('.root-header', els => els.map(e => e.textContent));
    expect(roots.some(r => r?.includes('Code'))).toBe(true);
    expect(roots.some(r => r?.includes('Workspace'))).toBe(true);
  });

  it('renders search input', async () => {
    const input = await page.$('.search-input');
    expect(input).not.toBeNull();
  });

  it('renders sort dropdown with three options', async () => {
    const options = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLOptionElement>('.sort-select option'), e => e.value));
    expect(options).toEqual(['date', 'name', 'language']);
  });

  it('shows card name and branch', async () => {
    const names = await page.$$eval('.card-name', els => els.map(e => e.textContent));
    expect(names).toContain('glossary');
    const branches = await page.$$eval('.card-branch', els => els.map(e => e.textContent?.trim()));
    expect(branches.some(b => b?.includes('main'))).toBe(true);
  });

  it('shows starred card with filled star icon', async () => {
    const starredCards = await page.$$('.card-overlay .star-btn.starred');
    expect(starredCards.length).toBeGreaterThan(0);
  });
});

// ── Search ──

describe('search', () => {
  it('filters out non-matching shelves', async () => {
    await page.type('.search-input', 'glossary');
    await new Promise(r => setTimeout(r, 300));

    const totalAfter = (await page.$$('.project-card')).length;
    expect(totalAfter).toBeGreaterThan(0);
    expect(totalAfter).toBeLessThan(10);
  });

  it('search by shelf name shows all cards in that shelf', async () => {
    await page.type('.search-input', 'Gems');
    await new Promise(r => setTimeout(r, 300));

    const names = await page.$$eval('.card-name', els => els.map(e => e.textContent));
    expect(names).toContain('glossary');
    expect(names).toContain('radio-client');
  });

  it('clears search with the clear button', async () => {
    await page.type('.search-input', 'test');
    await new Promise(r => setTimeout(r, 200));

    await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>('.search-clear');
      btn?.click();
    });
    await new Promise(r => setTimeout(r, 200));

    const inputValue = await page.evaluate(() => document.querySelector<HTMLInputElement>('.search-input')?.value);
    expect(inputValue).toBe('');
  });
});

// ── Sort ──

describe('sort', () => {
  it('defaults to "date" sort', async () => {
    const value = await page.evaluate(() => document.querySelector<HTMLSelectElement>('.sort-select')?.value);
    expect(value).toBe('date');
  });

  it('can switch to A-Z sort', async () => {
    await page.select('.sort-select', 'name');
    await new Promise(r => setTimeout(r, 200));
    const value = await page.evaluate(() => document.querySelector<HTMLSelectElement>('.sort-select')?.value);
    expect(value).toBe('name');
  });

  it('A-Z sort orders cards alphabetically within a shelf', async () => {
    await page.select('.sort-select', 'name');
    await new Promise(r => setTimeout(r, 300));

    const names = await page.evaluate(() => {
      const shelf = Array.from(document.querySelectorAll('.shelf-row'))
        .find(s => s.querySelector('.shelf-row-title')?.textContent?.includes('Gems'));
      if (!shelf) return [];
      return Array.from(shelf.querySelectorAll('.card-name'), e => e.textContent);
    });

    // glossary is starred → stays first. Rest should be alphabetical.
    if (names.length > 1) {
      const unstarred = names.slice(1);
      const sorted = [...unstarred].sort();
      expect(unstarred).toEqual(sorted);
    }
  });
});

// ── Round-Trip Card Interactions ──

describe('card interactions (round-trip)', () => {
  it('clicking star on unstarred card fills the star icon', async () => {
    // Find an unstarred card (Harbor is first, unstarred)
    const unstarredBefore = await page.$$eval('.card-overlay .star-btn:not(.starred)', els => els.length);
    expect(unstarredBefore).toBeGreaterThan(0);

    // Click star on the first unstarred card
    await page.evaluate(() => {
      const star = document.querySelector<HTMLElement>('.card-overlay .star-btn:not(.starred)');
      star?.click();
    });
    // Wait for mock host to respond with updated shelves
    await new Promise(r => setTimeout(r, 300));

    const unstarredAfter = await page.$$eval('.card-overlay .star-btn:not(.starred)', els => els.length);
    expect(unstarredAfter).toBe(unstarredBefore - 1);
  });

  it('clicking star on starred card un-fills the star icon', async () => {
    // glossary is starred
    const starredBefore = await page.$$eval('.card-overlay .star-btn.starred', els => els.length);
    expect(starredBefore).toBeGreaterThan(0);

    await page.evaluate(() => {
      const star = document.querySelector<HTMLElement>('.card-overlay .star-btn.starred');
      star?.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const starredAfter = await page.$$eval('.card-overlay .star-btn.starred', els => els.length);
    expect(starredAfter).toBe(starredBefore - 1);
  });

  it('hiding a card removes it from the grid', async () => {
    const cardsBefore = (await page.$$('.project-card')).length;

    // Hide the first card
    await page.evaluate(() => {
      const hide = document.querySelector<HTMLElement>('.project-card .hide-btn');
      hide?.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const cardsAfter = (await page.$$('.project-card')).length;
    expect(cardsAfter).toBe(cardsBefore - 1);
  });

  it('hiding a shelf removes its section and adds a hidden pill', async () => {
    const shelfsBefore = (await page.$$('.shelf-row')).length;
    const pillsBefore = (await page.$$('.hidden-pill')).length;

    // Click hide on the first shelf's hide button
    await page.evaluate(() => {
      const hide = document.querySelector<HTMLElement>('.shelf-row .shelf-actions .hide-btn');
      hide?.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const shelfsAfter = (await page.$$('.shelf-row')).length;
    const pillsAfter = (await page.$$('.hidden-pill')).length;
    expect(shelfsAfter).toBe(shelfsBefore - 1);
    expect(pillsAfter).toBe(pillsBefore + 1);
  });

  it('star persists after rescan', async () => {
    // Star a card
    await page.evaluate(() => {
      const star = document.querySelector<HTMLElement>('.card-overlay .star-btn:not(.starred)');
      star?.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const starredAfterStar = await page.$$eval('.card-overlay .star-btn.starred', els => els.length);

    // Trigger rescan
    await page.evaluate(() => {
      const rescan = document.querySelector<HTMLElement>('button[title="Rescan"]');
      rescan?.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const starredAfterRescan = await page.$$eval('.card-overlay .star-btn.starred', els => els.length);
    expect(starredAfterRescan).toBe(starredAfterStar);
  });
});

// ── Modal Interactions ──

describe('modal interactions', () => {
  it('clicking a card opens project detail modal', async () => {
    const card = await page.$('.project-card');
    await card!.click();
    await new Promise(r => setTimeout(r, 500));

    const modal = await page.$('.detail-modal');
    expect(modal).not.toBeNull();
  });

  it('project detail modal shows project name', async () => {
    const card = await page.$('.project-card');
    await card!.click();
    await new Promise(r => setTimeout(r, 500));

    const modalText = await page.$eval('.detail-modal', el => el.textContent);
    expect(modalText?.length).toBeGreaterThan(0);
  });

  it('Escape closes project detail modal', async () => {
    const card = await page.$('.project-card');
    await card!.click();
    await new Promise(r => setTimeout(r, 500));
    expect(await page.$('.detail-modal')).not.toBeNull();

    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
    expect(await page.$('.detail-modal')).toBeNull();
  });

  it('clicking shelf name opens shelf detail modal', async () => {
    await page.evaluate(() => {
      const title = document.querySelector('.shelf-row-title');
      const nameSpan = title?.querySelectorAll<HTMLElement>('span')[1];
      nameSpan?.click();
    });
    await new Promise(r => setTimeout(r, 500));

    const modal = await page.$('.shelf-modal-panel');
    expect(modal).not.toBeNull();
  });

  it('shelf modal shows project cards', async () => {
    await page.evaluate(() => {
      const title = document.querySelector('.shelf-row-title');
      const nameSpan = title?.querySelectorAll<HTMLElement>('span')[1];
      nameSpan?.click();
    });
    await new Promise(r => setTimeout(r, 500));

    const cards = await page.$$('.shelf-modal-panel .project-card');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('shelf modal has filter input', async () => {
    await page.evaluate(() => {
      const title = document.querySelector('.shelf-row-title');
      const nameSpan = title?.querySelectorAll<HTMLElement>('span')[1];
      nameSpan?.click();
    });
    await new Promise(r => setTimeout(r, 500));

    const filter = await page.$('.shelf-modal-search');
    expect(filter).not.toBeNull();
  });

  it('collapse arrow toggles shelf content', async () => {
    const arrow = await page.$('.shelf-row .collapse-arrow');
    const shelfRow = await page.$('.shelf-row');

    await arrow!.click();
    await new Promise(r => setTimeout(r, 300));

    const isCollapsed = await shelfRow!.evaluate(el => el.classList.contains('collapsed'));
    expect(isCollapsed).toBe(true);
  });
});

// ── Stale Fade ──

describe('stale fade', () => {
  it('toggles active class on clock button click', async () => {
    const clockBtn = await page.$('button[title="Fade stale projects"]');

    await clockBtn!.click();
    await new Promise(r => setTimeout(r, 200));
    expect(await clockBtn!.evaluate(el => el.classList.contains('active'))).toBe(true);

    await clockBtn!.click();
    await new Promise(r => setTimeout(r, 200));
    expect(await clockBtn!.evaluate(el => el.classList.contains('active'))).toBe(false);
  });

  it('stale fade applies reduced opacity to old projects', async () => {
    const clockBtn = await page.$('button[title="Fade stale projects"]');
    await clockBtn!.click();
    await new Promise(r => setTimeout(r, 300));

    const opacities = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.project-card'), e => parseFloat(e.style.opacity)));
    expect(opacities.some(o => o < 1)).toBe(true);
  });
});

// ── New Project Sparkle ──

describe('new project sparkle animation', () => {
  it('applies new-project class when a project is added via scan', async () => {
    const cardsBefore = (await page.$$('.project-card')).length;

    // Inject a new project via mock host
    await page.evaluate(() => {
      window.__mockHost?.addProject('Gems', {
        name: 'brand-new-gem',
        path: '/mock/code/Gems/brand-new-gem',
        markers: ['.git', '*.gemspec'],
        primaryLanguage: 'ruby',
        gitBranch: 'main',
        lastModified: Date.now(),
      });
    });
    await new Promise(r => setTimeout(r, 500));

    const cardsAfter = (await page.$$('.project-card')).length;
    expect(cardsAfter).toBe(cardsBefore + 1);

    // The new card should have the new-project class
    const newCards = await page.$$('.project-card.new-project');
    expect(newCards.length).toBe(1);
  });

  it('sparkle class is removed after timeout', async () => {
    await page.evaluate(() => {
      window.__mockHost?.addProject('Gems', {
        name: 'another-new',
        path: '/mock/code/Gems/another-new',
        markers: ['.git'],
        primaryLanguage: 'ruby',
        gitBranch: 'main',
        lastModified: Date.now(),
      });
    });
    await new Promise(r => setTimeout(r, 300));
    expect((await page.$$('.project-card.new-project')).length).toBe(1);

    // Wait for the 4s timeout to clear the class
    await new Promise(r => setTimeout(r, 4200));
    expect((await page.$$('.project-card.new-project')).length).toBe(0);
  });

  it('captures sparkle animation screenshot', async () => {
    await page.evaluate(() => {
      window.__mockHost?.addProject('Apps', {
        name: 'sparkle-test',
        path: '/mock/code/Apps/sparkle-test',
        markers: ['.git', '*.xcodeproj'],
        primaryLanguage: 'swift',
        gitBranch: 'main',
        lastModified: Date.now(),
      });
    });
    await new Promise(r => setTimeout(r, 400));
    const path = await screenshot(page, '08-new-project-sparkle');
    expect(path).toContain('08-new-project-sparkle.png');
  });
});

// ── Workspace Open Button ──

describe('workspace open button', () => {
  it('shows button group with workspace icon for projects with workspaceFile', async () => {
    const groups = await page.$$('.card-open-group.has-workspace');
    expect(groups.length).toBeGreaterThan(0);
  });

  it('does not show workspace icon for projects without workspaceFile', async () => {
    // Most cards should have a single-button group (no .has-workspace)
    const singleGroups = await page.$$('.card-open-group:not(.has-workspace)');
    expect(singleGroups.length).toBeGreaterThan(0);
  });

  it('workspace button sends postMessage with workspaceFile', async () => {
    const messages: string[] = [];
    page.on('console', msg => messages.push(msg.text()));

    await page.evaluate(() => {
      const wsBtn = document.querySelector<HTMLElement>('.card-open-workspace');
      wsBtn?.click();
    });
    await new Promise(r => setTimeout(r, 200));

    // Mock logs: "[postMessage] project:open {type: 'project:open', path: '...', workspaceFile: '...'}"
    expect(messages.some(m => m.includes('project:open') && m.includes('.code-workspace'))).toBe(true);
  });

  it('folder button sends postMessage without workspaceFile', async () => {
    const messages: string[] = [];
    page.on('console', msg => messages.push(msg.text()));

    await page.evaluate(() => {
      const group = document.querySelector('.card-open-group.has-workspace');
      const folderBtn = group?.querySelector<HTMLElement>('.card-open-btn:not(.card-open-workspace)');
      folderBtn?.click();
    });
    await new Promise(r => setTimeout(r, 200));

    // Folder button should send project:open without workspaceFile path
    const openMsgs = messages.filter(m => m.includes('project:open'));
    expect(openMsgs.length).toBeGreaterThan(0);
    // None of them should contain the .code-workspace path
    expect(openMsgs.every(m => !m.includes('.code-workspace'))).toBe(true);
  });
});

// ── Hidden Shelves ──

describe('hidden shelves', () => {
  it('does not render hidden shelf in visible rows', async () => {
    const titles = await page.$$eval('.shelf-row-title', els =>
      els.map(e => e.textContent?.trim())
    );
    expect(titles.every(t => !t?.includes('Archive'))).toBe(true);
  });

  it('shows hidden shelf as a pill in root header', async () => {
    const pills = await page.$$eval('.hidden-pill', els => els.map(e => e.textContent?.trim()));
    expect(pills).toContain('Archive');
  });
});

// ── Command Palette (Cmd/Ctrl+K) ──

async function openPalette(): Promise<void> {
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 200));
}

describe('command palette', () => {
  it('opens on Ctrl+K and lists projects, including ones from hidden shelves', async () => {
    await openPalette();
    expect(await page.$('.cmdk-panel')).not.toBeNull();
    const names = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.cmdk-item .cmdk-name'), e => e.textContent));
    expect(names).toContain('glossary');
    // 'old-project' lives under the hidden 'Archive' shelf — global search still finds it
    expect(names).toContain('old-project');
  });

  it('filters results as you type', async () => {
    await openPalette();
    await page.type('.cmdk-input', 'radio-client');
    await new Promise(r => setTimeout(r, 150));
    const names = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.cmdk-item .cmdk-name'), e => e.textContent));
    expect(names).toContain('radio-client');
    expect(names.length).toBeLessThanOrEqual(2);
  });

  it('Escape closes the palette', async () => {
    await openPalette();
    expect(await page.$('.cmdk-panel')).not.toBeNull();
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 150));
    expect(await page.$('.cmdk-panel')).toBeNull();
  });

  it('Enter opens the selected project (posts project:open)', async () => {
    const messages: string[] = [];
    page.on('console', msg => messages.push(msg.text()));
    await openPalette();
    await page.type('.cmdk-input', 'radio-client');
    await new Promise(r => setTimeout(r, 150));
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 150));
    expect(messages.some(m => m.includes('project:open') && m.includes('radio-client'))).toBe(true);
  });

  it('matches on indexed doc content and shows a snippet', async () => {
    await openPalette();
    // "esperanto" appears only in glossary's searchText corpus, not in any name
    await page.type('.cmdk-input', 'esperanto');
    await new Promise(r => setTimeout(r, 200));
    const names = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.cmdk-item .cmdk-name'), e => e.textContent));
    expect(names).toContain('glossary');
    const snippet = await page.$eval('.cmdk-snippet', el => el.textContent ?? '').catch(() => '');
    expect(snippet.toLowerCase()).toContain('esperanto');
  });
});

// ── Keyword tag chips ──

describe('keyword tags', () => {
  it('renders tag chips for a project that has them', async () => {
    const tags = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.project-card'))
        .find(c => c.querySelector('.card-name')?.textContent === 'glossary');
      return Array.from(card?.querySelectorAll('.card-tag') ?? [], e => e.textContent);
    });
    expect(tags).toContain('esperanto');
    expect(tags.length).toBeGreaterThan(0);
  });
});

// ── Worktree deck ──

function startpageCardInfo() {
  return page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.project-card'))
      .find(c => c.querySelector('.card-name')?.textContent === 'startpage');
    return {
      isDeck: card?.classList.contains('is-deck') ?? false,
      toggle: card?.querySelector('.worktree-toggle')?.textContent?.trim() ?? null,
    };
  });
}

async function clickStartpageToggle() {
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.project-card'))
      .find(c => c.querySelector('.card-name')?.textContent === 'startpage');
    card?.querySelector<HTMLElement>('.worktree-toggle')?.click();
  });
  await new Promise(r => setTimeout(r, 150));
}

describe('worktree deck', () => {
  it('renders a project with worktrees as a deck with a count toggle', async () => {
    const info = await startpageCardInfo();
    expect(info.isDeck).toBe(true);
    expect(info.toggle).toContain('2 worktrees');
  });

  it('a project without worktrees is not a deck', async () => {
    const isDeck = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.project-card'))
        .find(c => c.querySelector('.card-name')?.textContent === 'glossary');
      return card?.classList.contains('is-deck') ?? false;
    });
    expect(isDeck).toBe(false);
  });

  it('expands to list the worktree branches', async () => {
    await clickStartpageToggle();
    const branches = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.project-card'))
        .find(c => c.querySelector('.card-name')?.textContent === 'startpage');
      return Array.from(card?.querySelectorAll('.worktree-item') ?? [], e => e.textContent?.trim());
    });
    expect(branches.some(b => b?.includes('feature/card-deck'))).toBe(true);
    expect(branches.some(b => b?.includes('feature/content-search'))).toBe(true);
  });

  it('opening a worktree posts project:open with the worktree path', async () => {
    const messages: string[] = [];
    page.on('console', msg => messages.push(msg.text()));
    // Make sure the list is expanded.
    const expanded = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.project-card'))
        .find(c => c.querySelector('.card-name')?.textContent === 'startpage');
      return !!card?.querySelector('.worktree-list');
    });
    if (!expanded) await clickStartpageToggle();
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.project-card'))
        .find(c => c.querySelector('.card-name')?.textContent === 'startpage');
      card?.querySelector<HTMLElement>('.worktree-item')?.click();
    });
    await new Promise(r => setTimeout(r, 200));
    expect(messages.some(m => m.includes('project:open') && m.includes('startpage-worktrees'))).toBe(true);
  });
});

// ── Content search in the header filter ──

describe('header content search', () => {
  it('filters to a project by its indexed doc content (not just name)', async () => {
    await page.type('.search-input', 'esperanto');
    await new Promise(r => setTimeout(r, 300));
    const names = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.card-name'), e => e.textContent));
    expect(names).toContain('glossary');           // matched via corpus
    expect(names).not.toContain('radio-client');       // no esperanto in its corpus/name
  });
});

// ── Poster Generation (Mock) ──

describe('poster generation (round-trip)', () => {
  it('generates a mock poster via detail modal', async () => {
    // Open detail modal
    const card = await page.$('.project-card');
    await card!.click();
    await new Promise(r => setTimeout(r, 500));

    // Check no poster initially (fallback should be showing)
    const hasPosterBefore = await page.$eval('.detail-modal', el =>
      el.querySelector('.card-poster-image svg') !== null
    );
    // First card (Harbor) has no poster
    expect(hasPosterBefore).toBe(false);

    // Trigger poster generation via sparkle button if it exists
    const sparkleBtn = await page.$('.detail-modal .sparkle-btn');
    if (sparkleBtn) {
      await sparkleBtn.click();
      await new Promise(r => setTimeout(r, 100));
      // Click "Generate" in dropdown
      const genBtn = await page.$('.detail-modal .sparkle-menu button');
      if (genBtn) {
        await genBtn.click();
        await new Promise(r => setTimeout(r, 1000));

        // Should show poster now
        const hasPosterAfter = await page.evaluate(() =>
          document.querySelector('.detail-modal')?.innerHTML.includes('Mock Poster')
        );
        expect(hasPosterAfter).toBe(true);
      }
    }
  });
});

// ── Visual Oversight Screenshots ──

describe('visual oversight', () => {
  it('captures default state', async () => {
    const path = await screenshot(page, '01-default-state');
    expect(path).toContain('01-default-state.png');
  });

  it('captures A-Z sorted state', async () => {
    await page.select('.sort-select', 'name');
    await new Promise(r => setTimeout(r, 300));
    const path = await screenshot(page, '02-sorted-az');
    expect(path).toContain('02-sorted-az.png');
  });

  it('captures stale fade state', async () => {
    const clockBtn = await page.$('button[title="Fade stale projects"]');
    await clockBtn!.click();
    await new Promise(r => setTimeout(r, 300));
    const path = await screenshot(page, '03-stale-fade');
    expect(path).toContain('03-stale-fade.png');
  });

  it('captures project detail modal', async () => {
    const card = await page.$('.project-card');
    await card!.click();
    await new Promise(r => setTimeout(r, 500));
    const path = await screenshot(page, '04-project-detail');
    expect(path).toContain('04-project-detail.png');
  });

  it('captures shelf modal', async () => {
    await page.evaluate(() => {
      const title = document.querySelector('.shelf-row-title');
      const nameSpan = title?.querySelectorAll<HTMLElement>('span')[1];
      nameSpan?.click();
    });
    await new Promise(r => setTimeout(r, 500));
    const path = await screenshot(page, '05-shelf-modal');
    expect(path).toContain('05-shelf-modal.png');
  });

  it('captures search filtering', async () => {
    await page.type('.search-input', 'ruby');
    await new Promise(r => setTimeout(r, 300));
    const path = await screenshot(page, '06-search-filter');
    expect(path).toContain('06-search-filter.png');
  });

  it('captures workspace button group on hover', async () => {
    // Hover over the startpage card (has workspaceFile)
    const wsCard = await page.$('.project-card[title*="startpage"]');
    if (wsCard) {
      await wsCard.hover();
      await new Promise(r => setTimeout(r, 300));
    }
    const path = await screenshot(page, '09-workspace-button-group');
    expect(path).toContain('09-workspace-button-group.png');
  });

  it('captures state after starring + hiding', async () => {
    // Star a card
    await page.evaluate(() => {
      const star = document.querySelector<HTMLElement>('.card-overlay .star-btn:not(.starred)');
      star?.click();
    });
    await new Promise(r => setTimeout(r, 300));

    // Hide a card
    await page.evaluate(() => {
      const hide = document.querySelector<HTMLElement>('.project-card .hide-btn');
      hide?.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const path = await screenshot(page, '07-after-star-hide');
    expect(path).toContain('07-after-star-hide.png');
  });
});

// ── Shelf inline filter + overflow ──

async function typeShelfFilter(shelfName: string, value: string) {
  await page.evaluate(({ shelfName, value }) => {
    const row = Array.from(document.querySelectorAll('.shelf-row'))
      .find(r => r.querySelector('.shelf-row-title')?.textContent?.includes(shelfName));
    const input = row?.querySelector<HTMLInputElement>('.shelf-filter-input');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, { shelfName, value });
  await new Promise(r => setTimeout(r, 250));
}

function shelfState(shelfName: string) {
  return page.evaluate(name => {
    const row = Array.from(document.querySelectorAll('.shelf-row'))
      .find(r => r.querySelector('.shelf-row-title')?.textContent?.includes(name));
    return {
      present: !!row,
      hasFilterInput: !!row?.querySelector('.shelf-filter-input'),
      hasEmptyState: !!row?.querySelector('.shelf-empty'),
      cards: row?.querySelectorAll('.project-card').length ?? 0,
    };
  }, shelfName);
}

describe('shelf inline filter', () => {
  it('narrows the shelf to matching cards', async () => {
    await typeShelfFilter('Gems', 'glossary');
    const s = await shelfState('Gems');
    expect(s.cards).toBe(1);
    expect(s.hasEmptyState).toBe(false);
  });

  it('keeps the shelf AND its filter input when nothing matches', async () => {
    // Regression: this used to `return null`, unmounting the very input the user
    // was typing into — leaving no way to clear the filter (section "disappeared").
    await typeShelfFilter('Gems', 'zzzznomatch');
    const s = await shelfState('Gems');
    expect(s.present).toBe(true);
    expect(s.hasFilterInput).toBe(true);
    expect(s.hasEmptyState).toBe(true);
    expect(s.cards).toBe(0);
  });

  it('can recover via the Clear filter button', async () => {
    await typeShelfFilter('Gems', 'zzzznomatch');
    await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.shelf-row'))
        .find(r => r.querySelector('.shelf-row-title')?.textContent?.includes('Gems'));
      row?.querySelector<HTMLElement>('.shelf-empty-clear')?.click();
    });
    await new Promise(r => setTimeout(r, 250));
    const s = await shelfState('Gems');
    expect(s.hasEmptyState).toBe(false);
    expect(s.cards).toBeGreaterThan(0);
  });
});

describe('large shelf overflow', () => {
  async function injectBigShelf(n: number) {
    await page.evaluate(count => {
      window.__mockHost?.injectShelves([{
        name: 'Big', path: '/mock/big', rootLabel: 'Mock', rootPath: '/mock',
        items: Array.from({ length: count }, (_, i) => ({
          kind: 'project' as const,
          project: { name: `big-${i}`, path: `/mock/big/p${i}`, markers: ['.git'], lastModified: Date.now() - i * 1000 },
        })),
      }]);
    }, n);
    await new Promise(r => setTimeout(r, 400));
  }

  it('renders full-height cards regardless of how many are in the shelf', async () => {
    // Regression: a constrained grid distributed its height across every implicit
    // row, squeezing 70 cards down to ~11px slivers.
    await injectBigShelf(40);
    const h = await page.evaluate(() =>
      Math.round(document.querySelector('.project-card')!.getBoundingClientRect().height));
    expect(h).toBeGreaterThan(150);
  });

  it('offers a "Show N more" toggle counting only what is hidden', async () => {
    await injectBigShelf(40);
    const label = await page.evaluate(() => document.querySelector('.shelf-showmore')?.textContent ?? '');
    const hidden = Number(/Show (\d+) more/.exec(label)?.[1]);
    expect(label).toMatch(/Show \d+ more/);
    // Some cards fit on the first row, so the count is strictly less than the total.
    expect(hidden).toBeGreaterThan(0);
    expect(hidden).toBeLessThan(40);
    await page.evaluate(() => document.querySelector<HTMLElement>('.shelf-showmore')?.click());
    await new Promise(r => setTimeout(r, 300));
    const after = await page.evaluate(() => ({
      label: document.querySelector('.shelf-showmore')?.textContent ?? '',
      expanded: !!document.querySelector('.shelf-row-content.expanded'),
    }));
    expect(after.expanded).toBe(true);
    expect(after.label).toBe('Show less');
  });

  it('does not offer the toggle for a shelf that already fits', async () => {
    await injectBigShelf(2);
    expect(await page.$('.shelf-showmore')).toBeNull();
  });

  it('does not offer the toggle when one card is taller than its row-mates', async () => {
    // Regression: the check was `scrollHeight > clientHeight`, so a single card
    // running a few px past a fixed height cap (e.g. one carrying a worktree
    // row) made a fully-visible shelf advertise "Show all 4".
    await page.evaluate(() => {
      window.__mockHost?.injectShelves([{
        name: 'Mixed', path: '/mock/mixed', rootLabel: 'Mock', rootPath: '/mock',
        items: [0, 1, 2].map(i => ({
          kind: 'project' as const,
          project: {
            name: `m-${i}`, path: `/mock/mixed/p${i}`, markers: ['.git'], lastModified: Date.now(),
            tags: ['alpha', 'beta', 'gamma'],
            // the first card is taller: it carries a worktree deck
            ...(i === 0 ? { worktrees: [{ name: 'wt', path: '/mock/mixed/wt', gitBranch: 'feature/x', lastModified: Date.now() }] } : {}),
          },
        })),
      }]);
    });
    await new Promise(r => setTimeout(r, 450));
    expect(await page.$$('.project-card')).toHaveLength(3);
    expect(await page.$('.shelf-showmore')).toBeNull();
  });
});

// ── Bookset grouping ──

describe('bookset rendering', () => {
  async function injectBookset(count: number, flatten?: 'always' | 'never') {
    await page.evaluate(({ count, flatten }) => {
      window.__mockHost?.injectShelves([{
        name: 'Grouped', path: '/mock/grouped', rootLabel: 'Mock', rootPath: '/mock',
        ...(flatten ? { flatten } : {}),
        items: [
          { kind: 'project' as const, project: { name: 'loose-one', path: '/mock/grouped/loose', markers: ['.git'], lastModified: Date.now() } },
          {
            kind: 'bookset' as const, name: 'Notion', path: '/mock/grouped/Notion',
            projects: Array.from({ length: count }, (_, i) => ({
              name: `n-${i}`, path: `/mock/grouped/Notion/n${i}`, markers: ['.git'], lastModified: Date.now() - i * 1000,
            })),
          },
        ],
      }]);
    }, { count, flatten });
    await new Promise(r => setTimeout(r, 400));
  }

  it('renders a bookset over the threshold as a named group with a count', async () => {
    // Regression: booksets were always flattened into the shelf grid, so the
    // entire .bookset stylesheet was dead code and `flatten` had no visual effect.
    await injectBookset(10);
    const g = await page.evaluate(() => ({
      groups: document.querySelectorAll('.bookset').length,
      name: document.querySelector('.bookset-name')?.textContent ?? null,
      count: document.querySelector('.bookset-count')?.textContent ?? null,
      inside: document.querySelectorAll('.bookset-projects .project-card').length,
    }));
    expect(g.groups).toBe(1);
    expect(g.name).toBe('Notion');
    expect(g.count).toBe('10');
    expect(g.inside).toBe(10);
  });

  it('flattens a bookset at or under the threshold into the shelf grid', async () => {
    await injectBookset(3);
    expect(await page.$('.bookset')).toBeNull();
    const cards = await page.$$eval('.project-card .card-name', els => els.map(e => e.textContent));
    expect(cards).toContain('n-0');
    expect(cards).toContain('loose-one');
  });

  it('honors flatten: "never" for a small bookset', async () => {
    await injectBookset(2, 'never');
    expect(await page.$('.bookset')).not.toBeNull();
    expect(await page.$eval('.bookset-count', e => e.textContent)).toBe('2');
  });

  it('honors flatten: "always" for a large bookset', async () => {
    await injectBookset(12, 'always');
    expect(await page.$('.bookset')).toBeNull();
  });
});

// ── Inline shelf spanning ──

describe('inline shelf spanning', () => {
  async function injectShelves(sizes: number[]) {
    await page.evaluate(counts => {
      window.__mockHost?.injectShelves(counts.map((n, s) => ({
        name: `S${s}`, path: `/mock/s${s}`, rootLabel: 'Mock', rootPath: '/mock',
        items: Array.from({ length: n }, (_, i) => ({
          kind: 'project' as const,
          project: { name: `s${s}-${i}`, path: `/mock/s${s}/p${i}`, markers: ['.git'], lastModified: Date.now() - i * 1000 },
        })),
      })));
    }, sizes);
    await new Promise(r => setTimeout(r, 600));
  }

  function shelfBox(name: string) {
    return page.evaluate(n => {
      const row = Array.from(document.querySelectorAll('.shelf-row'))
        .find(r => r.querySelector('.shelf-row-title')?.textContent?.includes(n));
      const bed = row?.parentElement;
      const rb = row?.getBoundingClientRect();
      return {
        inline: row?.classList.contains('shelf-inline') ?? false,
        width: rb ? Math.round(rb.width) : 0,
        top: rb ? Math.round(rb.top) : 0,
        bedWidth: bed ? Math.round(bed.getBoundingClientRect().width) : 0,
      };
    }, name);
  }

  it('lets a shelf that fits claim only the columns it needs', async () => {
    await injectShelves([3, 3]);
    const a = await shelfBox('S0');
    expect(a.inline).toBe(true);
    expect(a.width).toBeLessThan(a.bedWidth * 0.8);
  });

  it('flows two small shelves onto the same row instead of stacking them', async () => {
    // This is the point: a 4-card shelf used to eat a full row and push the next
    // shelf down, which is where the scrolling and whitespace came from.
    await injectShelves([3, 3]);
    const [a, b] = [await shelfBox('S0'), await shelfBox('S1')];
    expect(a.top).toBe(b.top);
  });

  it('never shrinks a shelf below its own title row', async () => {
    // The floor used to be a flat 3-of-12 columns. It is now the header's own
    // width, so a long shelf name can't be squeezed into an ellipsis.
    await page.evaluate(() => {
      window.__mockHost?.injectShelves([{
        name: 'Firmware Experiments From Years Ago', path: '/mock/long', rootLabel: 'Mock', rootPath: '/mock',
        items: [{ kind: 'project' as const, project: { name: 'one', path: '/mock/long/p', markers: ['.git'], lastModified: Date.now() } }],
      }]);
    });
    await new Promise(r => setTimeout(r, 600));
    const t = await page.evaluate(() => {
      const label = document.querySelector('.shelf-row-title')?.children[1] as HTMLElement | undefined;
      return label ? { clientW: label.clientWidth, scrollW: label.scrollWidth } : null;
    });
    expect(t).not.toBeNull();
    expect(t!.scrollW).toBeLessThanOrEqual(t!.clientW + 1); // not ellipsised
  });

  it('keeps a shelf that cannot fit as a full-width band', async () => {
    await injectShelves([40]);
    const big = await shelfBox('S0');
    expect(big.inline).toBe(false);
    expect(big.width).toBeGreaterThan(big.bedWidth * 0.95);
  });
});

// ── View modes ──

describe('view modes', () => {
  async function switchTo(label: string) {
    await page.evaluate(l => {
      Array.from(document.querySelectorAll<HTMLElement>('.view-switch-btn'))
        .find(b => b.textContent === l)?.click();
    }, label);
    await new Promise(r => setTimeout(r, 400));
  }

  it('offers all three lenses and starts on Shelves', async () => {
    const labels = await page.$$eval('.view-switch-btn', els => els.map(e => e.textContent));
    expect(labels).toEqual(['Shelves', 'Workbench', 'Timeline']);
    expect(await page.$eval('.view-switch-btn.active', e => e.textContent)).toBe('Shelves');
    expect(await page.$('.bench')).toBeNull();
    expect(await page.$('.timeline')).toBeNull();
  });

  it('Workbench puts recent work on a bench above the shelves', async () => {
    await switchTo('Workbench');
    expect(await page.$('.bench')).not.toBeNull();
    // The shelves are still there — the bench is an addition, not a replacement.
    expect((await page.$$('.shelf-row')).length).toBeGreaterThan(0);
    const benched = await page.$$eval('.bench-name', els => els.map(e => e.textContent?.trim()));
    expect(benched.length).toBeGreaterThan(0);
  });

  it('Timeline replaces the shelves with age bands', async () => {
    await switchTo('Timeline');
    expect(await page.$('.timeline')).not.toBeNull();
    expect(await page.$$('.shelf-row')).toHaveLength(0);
    const bands = await page.$$eval('.tl-band-name', els => els.map(e => e.textContent));
    expect(bands.length).toBeGreaterThan(0);
    // every band label comes from the fixed ladder, newest first
    const ladder = ['Today', 'This week', 'This month', 'Months', 'This year', 'The deep past'];
    expect(bands.every(b => ladder.includes(b!))).toBe(true);
    expect(bands).toEqual(ladder.filter(l => bands.includes(l)));
  });

  it('shows every visible project exactly once in the timeline', async () => {
    await switchTo('Timeline');
    const expected = await page.evaluate(() => {
      const shelves = window.__mockHost?.getShelves() ?? [];
      let n = 0;
      for (const s of shelves) {
        if (s.hidden) continue;
        for (const i of s.items) n += i.kind === 'project' ? 1 : i.projects.length;
      }
      return n;
    });
    expect((await page.$$('.tl-item')).length).toBe(expected);
  });

  it('returns to the shelves', async () => {
    await switchTo('Timeline');
    await switchTo('Shelves');
    expect(await page.$('.timeline')).toBeNull();
    expect((await page.$$('.shelf-row')).length).toBeGreaterThan(0);
  });
});

// ── Language filter chips ──

describe('language chips', () => {
  const chipTexts = () => page.$$eval('.lang-chip', els => els.map(e => e.textContent ?? ''));
  async function clickChip(lang: string) {
    await page.evaluate(l => {
      Array.from(document.querySelectorAll<HTMLElement>('.lang-chip'))
        .find(c => (c.textContent ?? '').includes(l))?.click();
    }, lang);
    await new Promise(r => setTimeout(r, 400));
  }

  it('lists the languages present, most common first, with counts', async () => {
    const texts = await chipTexts();
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.some(t => t.includes('ruby'))).toBe(true);
  });

  it('switching a language off removes exactly its projects', async () => {
    const before = (await page.$$('.project-card')).length;
    const rubyCount = await page.evaluate(() => {
      const shelves = window.__mockHost?.getShelves() ?? [];
      let n = 0;
      for (const s of shelves) {
        if (s.hidden) continue;
        for (const i of s.items) {
          const ps = i.kind === 'project' ? [i.project] : i.projects;
          n += ps.filter(p => p.primaryLanguage === 'ruby').length;
        }
      }
      return n;
    });
    await clickChip('ruby');
    expect((await page.$$('.project-card')).length).toBe(before - rubyCount);
  });

  it('keeps the chip visible once its language is off, so it can be undone', async () => {
    await clickChip('ruby');
    const off = await page.$$eval('.lang-chip.off', els => els.map(e => e.textContent ?? ''));
    expect(off.some(t => t.includes('ruby'))).toBe(true);
  });

  it('"Show all" restores everything', async () => {
    const before = (await page.$$('.project-card')).length;
    await clickChip('ruby');
    expect((await page.$$('.project-card')).length).toBeLessThan(before);
    await page.evaluate(() => document.querySelector<HTMLElement>('.lang-reset')?.click());
    await new Promise(r => setTimeout(r, 400));
    expect((await page.$$('.project-card')).length).toBe(before);
    expect(await page.$('.lang-chip.off')).toBeNull();
  });
});
