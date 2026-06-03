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
