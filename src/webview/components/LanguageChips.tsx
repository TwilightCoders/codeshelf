import { LANGUAGE_COLORS, hashColor } from './helpers';
import { NO_LANGUAGE, type LangCount } from './pure';
export { NO_LANGUAGE, langKey, languageCounts, type LangCount } from './pure';

interface Props {
  counts: LangCount[];
  excluded: Set<string>;
  onToggle: (lang: string) => void;
  onReset: () => void;
}

export function LanguageChips({ counts, excluded, onToggle, onReset }: Props) {
  if (counts.length < 2) return null;

  return (
    <div className="lang-filter" role="group" aria-label="Filter by language">
      {counts.map(({ lang, count }) => {
        const off = excluded.has(lang);
        return (
          <button key={lang} className={`lang-chip ${off ? 'off' : ''}`}
            aria-pressed={!off} title={`${count} project${count === 1 ? '' : 's'}`}
            onClick={() => onToggle(lang)}>
            <span className="lang-dot" style={{ backgroundColor: LANGUAGE_COLORS[lang] ?? hashColor(lang) }} />
            {lang === NO_LANGUAGE ? 'no language' : lang}
            <span className="lang-n">{count}</span>
          </button>
        );
      })}
      {excluded.size > 0 && (
        <button className="lang-reset" onClick={onReset}>Show all</button>
      )}
    </div>
  );
}
