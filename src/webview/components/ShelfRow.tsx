import { useState, useRef, useLayoutEffect } from 'react';
import type { Shelf, Project, BooksetItem } from '../../shared/types';
import { postMsg, sortProjects, projectMatchesQuery } from './helpers';
import { langKey } from './pure';
import type { SortBy } from './pure';
import { ProjectCard } from './ProjectCard';

interface Props {
  shelf: Shelf;
  query: string;
  booksetThreshold: number;
  forgingPaths: Set<string>;
  sortBy: SortBy;
  staleFade: boolean;
  newPaths: Set<string>;
  excludedLangs: Set<string>;
  onProjectClick: (path: string) => void;
  onShelfClick: (shelf: Shelf) => void;
}

const COLUMNS = 12;
const MIN_SPAN = 2;  // absolute floor; the real floor is the shelf's own title
const SLACK = 4;     // a hair of room so a title never lands exactly on the edge

export function ShelfRow({ shelf, query, booksetThreshold, forgingPaths, sortBy, staleFade, newPaths, excludedLangs, onProjectClick, onShelfClick }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [inlineFilter, setInlineFilter] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const lastBedWidth = useRef(-1);
  const [inline, setInline] = useState(false);

  // Filtering. The global query and this shelf's own inline filter are
  // INDEPENDENT narrowing steps: they used to share one `q`, so a global search
  // silently shadowed whatever the user typed into the shelf's filter box.
  const localQ = inlineFilter.toLowerCase().trim();
  const globalQ = query && !shelf.name.toLowerCase().includes(query) ? query : '';
  const narrow = (ps: Project[]) => {
    let out = excludedLangs.size > 0 ? ps.filter(p => !excludedLangs.has(langKey(p))) : ps;
    if (globalQ) out = out.filter(p => projectMatchesQuery(p, globalQ));
    if (localQ) out = out.filter(p => projectMatchesQuery(p, localQ));
    return sortProjects(out, sortBy);
  };

  // Whether a bookset stays a visible group. Per `codeshelf.booksetThreshold`:
  // "booksets with this many or fewer total projects are flattened into the
  // shelf grid". `flatten: 'never' | 'always'` forces it either way. Until now
  // this decision had no visual effect at all — booksets were always flattened
  // into one grid, so the whole `.bookset` stylesheet was dead code.
  const keepGrouped = (b: BooksetItem) =>
    shelf.flatten === 'never' || (shelf.flatten !== 'always' && b.projects.length > booksetThreshold);

  // Loose cards (including projects lifted out of flattened booksets), plus the
  // booksets that stay grouped.
  const loose: Project[] = [];
  const groups: BooksetItem[] = [];
  for (const item of shelf.items) {
    if (item.kind === 'project') { loose.push(item.project); continue; }
    if (keepGrouped(item)) {
      const kept = narrow(item.projects);
      if (kept.length > 0) groups.push({ ...item, projects: kept });
    } else {
      loose.push(...item.projects);
    }
  }
  const looseProjects = narrow(loose);

  const projectCount = looseProjects.length + groups.reduce((n, g) => n + g.projects.length, 0);
  // How wide does this shelf actually need to be? Spanning the full bed for a
  // 4-card shelf left ~1000px empty and pushed everything else down a row, so
  // instead each shelf claims only the columns its cards occupy and the bed's
  // `dense` packing flows the rest in beside it. A shelf that needs the whole
  // bed (or holds a bookset, which is a full-width block) stays a band.
  useLayoutEffect(() => {
    const section = sectionRef.current;
    const bed = section?.parentElement;
    if (!section || !bed) return;

    const fit = () => {
      if (groups.length > 0 || projectCount === 0) {
        section.style.gridColumn = '';
        setInline(false);
        return;
      }
      const bedCs = getComputedStyle(bed);
      const cols = bedCs.gridTemplateColumns.split(' ').filter(Boolean).length || COLUMNS;
      const colGap = parseFloat(bedCs.columnGap) || 0;
      const bedW = bed.clientWidth;
      if (!(bedW > 0)) return;
      const colW = (bedW - (cols - 1) * colGap) / cols;
      if (!(colW > 0)) return;

      // Measure unconstrained. The shelf name is ellipsised once the cell is
      // narrow, so reading it at the current width under-measures and the shelf
      // would keep shrinking toward its own truncation.
      section.style.gridColumn = `span ${cols}`;

      const cs = getComputedStyle(section);
      const cardW = parseFloat(cs.getPropertyValue('--card-w')) || 156;
      const cardGap = contentRef.current ? parseFloat(getComputedStyle(contentRef.current).columnGap) || 0 : 0;
      const cardsWant = projectCount * cardW + (projectCount - 1) * cardGap;

      // The title row — name, the action buttons and the filter box — is the
      // real minimum: a shelf may never be narrower than its own header.
      const title = titleRef.current;
      let titleWant = 0;
      if (title) {
        const tGap = parseFloat(getComputedStyle(title).columnGap) || 0;
        const kids = Array.from(title.children);
        titleWant = kids.reduce((w, k) => w + k.getBoundingClientRect().width, 0)
          + tGap * Math.max(0, kids.length - 1);
      }

      // The padding and border a cell GAINS when it goes inline. Reading them off
      // the element is wrong here: while we measure it is still a band, which has
      // neither — and that missing ~26px is exactly what pushed a short title
      // like "Navy" into an ellipsis once the cell appeared.
      const cellPad = parseFloat(cs.getPropertyValue('--s4')) || 12;
      const chrome = cellPad * 2 + 2 + SLACK;
      const want = Math.max(cardsWant, titleWant) + chrome;
      const span = Math.max(MIN_SPAN, Math.min(cols, Math.ceil((want + colGap) / (colW + colGap))));
      section.style.gridColumn = `span ${span}`;
      setInline(span < cols);
    };

    // Only re-fit when the bed's WIDTH changes. Setting a span changes the bed's
    // height, which would otherwise bounce the observer straight back in.
    const onResize = () => {
      const w = bed.clientWidth;
      if (w === lastBedWidth.current) return;
      lastBedWidth.current = w;
      fit();
    };

    lastBedWidth.current = bed.clientWidth;
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(onResize);
    ro.observe(bed);
    return () => ro.disconnect();
  }, [projectCount, groups.length, collapsed]);
  const showEmpty = projectCount === 0;

  // Size the collapsed preview to EXACTLY the first row, and count what that
  // hides. Comparing scrollHeight to clientHeight only answered "is a pixel
  // clipped?", so a shelf whose tallest card ran a few px past a fixed height
  // cap advertised "Show all 4" while all four were plainly visible. Measuring
  // the real first row also means no card is ever cut mid-body, whatever card
  // height the stylesheet chooses.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) { setHiddenCount(0); return; }

    const measure = () => {
      if (expanded) { el.style.maxHeight = ''; setHiddenCount(0); return; }
      const rows = Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
      if (rows.length === 0) { el.style.maxHeight = ''; setHiddenCount(0); return; }
      // Let the content size itself before reading offsets.
      el.style.maxHeight = '';
      const top = Math.min(...rows.map(r => r.offsetTop));
      const firstRow = rows.filter(r => r.offsetTop <= top + 4);
      const rest = rows.filter(r => r.offsetTop > top + 4);
      const bottom = Math.max(...firstRow.map(r => r.offsetTop + r.offsetHeight));
      const padBottom = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      // Projects hidden = everything below the first row (a bookset counts as
      // the number of cards inside it, not as one item).
      const hidden = rest.reduce((n, r) =>
        n + (r.classList.contains('bookset') ? r.querySelectorAll('.project-card').length : 1), 0);
      if (rest.length > 0) el.style.maxHeight = `${bottom - top + padBottom}px`;
      setHiddenCount(hidden);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed, expanded, projectCount]);

  // A GLOBAL search miss hides the shelf. A local-filter miss must NOT: the
  // filter input lives inside this subtree, so bailing out here would strand the
  // user with text they typed and no visible way to clear it.
  if (showEmpty && !localQ) return null;

  return (
    <section ref={sectionRef} className={`shelf-row ${collapsed ? 'collapsed' : ''} ${inline ? 'shelf-inline' : ''} ${shelf.starred ? 'starred-shelf' : ''}`}>
      <h3 ref={titleRef} className="shelf-row-title">
        <span className={`collapse-arrow ${collapsed ? 'collapsed' : ''}`} role="button" tabIndex={0}
          aria-expanded={!collapsed} aria-label={collapsed ? 'Expand shelf' : 'Collapse shelf'}
          onClick={() => setCollapsed(!collapsed)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(!collapsed); } }}>&#9656;</span>
        <span onClick={() => onShelfClick(shelf)} style={{ cursor: 'pointer' }}>{shelf.name}</span>
        <span className="shelf-actions">
          <button className={`action-btn star-btn ${shelf.starred ? 'starred' : ''}`} title="Star" onClick={e => { e.stopPropagation(); postMsg({ type: 'item:star', path: shelf.path, rootPath: shelf.rootPath, starred: !shelf.starred, kind: 'shelf' }); }}>
            <i className={`codicon codicon-star-${shelf.starred ? 'full' : 'empty'}`} />
          </button>
          <button className="action-btn hide-btn" title="Hide" onClick={e => { e.stopPropagation(); postMsg({ type: 'item:hide', path: shelf.path, rootPath: shelf.rootPath, hidden: true, kind: 'shelf' }); }}>
            <i className="codicon codicon-eye-closed" />
          </button>
          <button className="action-btn reveal-btn" title="Reveal in Finder" onClick={e => { e.stopPropagation(); postMsg({ type: 'folder:reveal', path: shelf.path }); }}>
            <i className="codicon codicon-folder-opened" />
          </button>
          <input type="text" className="shelf-filter-input" placeholder="Filter..." value={inlineFilter}
            onClick={e => e.stopPropagation()} onChange={e => setInlineFilter(e.target.value)} />
        </span>
      </h3>
      {!collapsed && (showEmpty ? (
        <p className="shelf-empty">
          No projects in this shelf match &ldquo;{inlineFilter}&rdquo;.
          <button className="shelf-empty-clear" onClick={() => setInlineFilter('')}>Clear filter</button>
        </p>
      ) : (
        <>
          <div ref={contentRef} className={`shelf-row-content ${expanded ? 'expanded' : ''} ${hiddenCount > 0 && !expanded ? 'has-overflow' : ''}`}>
            {groups.map(g => (
              <div key={g.path} className="bookset">
                <div className="bookset-header">
                  <span className="bookset-name">{g.name}</span>
                  <span className="bookset-count">{g.projects.length}</span>
                </div>
                <div className="bookset-projects">
                  {g.projects.map(p => (
                    <ProjectCard key={p.path} project={p} rootPath={shelf.rootPath} forging={forgingPaths.has(p.path)} staleFade={staleFade} isNew={newPaths.has(p.path)} onOpen={onProjectClick} />
                  ))}
                </div>
              </div>
            ))}
            {looseProjects.map(p => (
              <ProjectCard key={p.path} project={p} rootPath={shelf.rootPath} forging={forgingPaths.has(p.path)} staleFade={staleFade} isNew={newPaths.has(p.path)} onOpen={onProjectClick} />
            ))}
          </div>
          {(hiddenCount > 0 || expanded) && (
            <button className="shelf-showmore" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
              {expanded ? 'Show less' : `Show ${hiddenCount} more`}
            </button>
          )}
        </>
      ))}
    </section>
  );
}
