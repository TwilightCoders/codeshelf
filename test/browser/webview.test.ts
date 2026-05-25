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

  it('renders correct number of cards (10 visible from mock data)', async () => {
    const cards = await page.$$('.project-card');
    expect(cards.length).toBe(10);
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
    const options = await page.$$eval('.sort-select option', els => els.map(e => (e as HTMLOptionElement).value));
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
      const btn = document.querySelector('.search-clear') as HTMLElement;
      btn?.click();
    });
    await new Promise(r => setTimeout(r, 200));

    const inputValue = await page.$eval('.search-input', el => (el as HTMLInputElement).value);
    expect(inputValue).toBe('');
  });
});

// ── Sort ──

describe('sort', () => {
  it('defaults to "date" sort', async () => {
    const value = await page.$eval('.sort-select', el => (el as HTMLSelectElement).value);
    expect(value).toBe('date');
  });

  it('can switch to A-Z sort', async () => {
    await page.select('.sort-select', 'name');
    await new Promise(r => setTimeout(r, 200));
    const value = await page.$eval('.sort-select', el => (el as HTMLSelectElement).value);
    expect(value).toBe('name');
  });

  it('A-Z sort orders cards alphabetically within a shelf', async () => {
    await page.select('.sort-select', 'name');
    await new Promise(r => setTimeout(r, 300));

    const gemsShelf = await page.evaluateHandle(() => {
      const shelves = document.querySelectorAll('.shelf-row');
      return Array.from(shelves).find(s => s.querySelector('.shelf-row-title')?.textContent?.includes('Gems'));
    });
    const names = await page.evaluate(el => {
      if (!el) return [];
      return Array.from((el as Element).querySelectorAll('.card-name')).map(e => e.textContent);
    }, gemsShelf);

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
      const star = document.querySelector('.card-overlay .star-btn:not(.starred)') as HTMLElement;
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
      const star = document.querySelector('.card-overlay .star-btn.starred') as HTMLElement;
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
      const hide = document.querySelector('.project-card .hide-btn') as HTMLElement;
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
      const hide = document.querySelector('.shelf-row .shelf-actions .hide-btn') as HTMLElement;
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
      const star = document.querySelector('.card-overlay .star-btn:not(.starred)') as HTMLElement;
      star?.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const starredAfterStar = await page.$$eval('.card-overlay .star-btn.starred', els => els.length);

    // Trigger rescan
    await page.evaluate(() => {
      const rescan = document.querySelector('button[title="Rescan"]') as HTMLElement;
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
      const nameSpan = title?.querySelectorAll('span')[1];
      (nameSpan as HTMLElement)?.click();
    });
    await new Promise(r => setTimeout(r, 500));

    const modal = await page.$('.shelf-modal-panel');
    expect(modal).not.toBeNull();
  });

  it('shelf modal shows project cards', async () => {
    await page.evaluate(() => {
      const title = document.querySelector('.shelf-row-title');
      const nameSpan = title?.querySelectorAll('span')[1];
      (nameSpan as HTMLElement)?.click();
    });
    await new Promise(r => setTimeout(r, 500));

    const cards = await page.$$('.shelf-modal-panel .project-card');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('shelf modal has filter input', async () => {
    await page.evaluate(() => {
      const title = document.querySelector('.shelf-row-title');
      const nameSpan = title?.querySelectorAll('span')[1];
      (nameSpan as HTMLElement)?.click();
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

    const opacities = await page.$$eval('.project-card', els =>
      els.map(e => parseFloat((e as HTMLElement).style.opacity))
    );
    expect(opacities.some(o => o < 1)).toBe(true);
  });
});

// ── New Project Sparkle ──

describe('new project sparkle animation', () => {
  it('applies new-project class when a project is added via scan', async () => {
    const cardsBefore = (await page.$$('.project-card')).length;

    // Inject a new project via mock host
    await page.evaluate(() => {
      (window as unknown as { __mockHost: { addProject: (shelf: string, project: unknown) => void } }).__mockHost.addProject('Gems', {
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
      (window as unknown as { __mockHost: { addProject: (shelf: string, project: unknown) => void } }).__mockHost.addProject('Gems', {
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
      (window as unknown as { __mockHost: { addProject: (shelf: string, project: unknown) => void } }).__mockHost.addProject('Apps', {
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
      const wsBtn = document.querySelector('.card-open-workspace') as HTMLElement;
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
      const folderBtn = group?.querySelector('.card-open-btn:not(.card-open-workspace)') as HTMLElement;
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
      const nameSpan = title?.querySelectorAll('span')[1];
      (nameSpan as HTMLElement)?.click();
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
    const wsCard = await page.evaluateHandle(() => {
      const cards = document.querySelectorAll('.project-card');
      return Array.from(cards).find(c => c.getAttribute('title')?.includes('startpage'));
    });
    if (wsCard) {
      await (wsCard as unknown as import('puppeteer-core').ElementHandle).hover();
      await new Promise(r => setTimeout(r, 300));
    }
    const path = await screenshot(page, '09-workspace-button-group');
    expect(path).toContain('09-workspace-button-group.png');
  });

  it('captures state after starring + hiding', async () => {
    // Star a card
    await page.evaluate(() => {
      const star = document.querySelector('.card-overlay .star-btn:not(.starred)') as HTMLElement;
      star?.click();
    });
    await new Promise(r => setTimeout(r, 300));

    // Hide a card
    await page.evaluate(() => {
      const hide = document.querySelector('.project-card .hide-btn') as HTMLElement;
      hide?.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const path = await screenshot(page, '07-after-star-hide');
    expect(path).toContain('07-after-star-hide.png');
  });
});
