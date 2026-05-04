/**
 * VerseDisplay — renders the current verse.
 * Single verse → quoted block.
 * Multi-verse range → each verse separated with a superscript number.
 *
 * Props:
 *   verse  — { text, verses, reference, translationName } | null
 *   mode   — 'projection' | 'sidepanel' | 'mobile'
 *   colors — { primary, bg, text } from church white-label settings
 */
export default function VerseDisplay({ verse, mode, colors = {} }) {
  const size =
    mode === 'projection' ? 'text-3xl md:text-4xl lg:text-5xl' :
    mode === 'sidepanel'  ? 'text-2xl md:text-3xl' :
                            'text-xl';

  const gold = colors.primary || '#d4af37';
  const muted = '#5a6a7a';

  if (!verse) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[200px]">
        <p className="font-serif text-lg italic text-center px-4" style={{ color: muted }}>
          Listening for scripture references…
        </p>
      </div>
    );
  }

  const isMultiVerse = verse.verses && verse.verses.length > 1;

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-8 px-4 animate-fade-in">
      {isMultiVerse ? (
        <div className={`font-serif leading-relaxed mb-6 w-full max-w-3xl text-center space-y-3 ${size}`}
             style={{ color: colors.text || '#f5ead6' }}>
          {verse.verses.map(v => (
            <p key={v.verseNumber}>
              <sup className="font-sans" style={{ fontSize: '0.45em', verticalAlign: 'super', marginRight: '0.35em', color: '#8a9aaa' }}>
                {v.verseNumber}
              </sup>
              {v.text}
            </p>
          ))}
        </div>
      ) : (
        <blockquote className={`font-serif leading-relaxed mb-6 text-center ${size}`}
                    style={{ color: colors.text || '#f5ead6' }}>
          "{verse.text}"
        </blockquote>
      )}
      <p className="font-sans font-semibold text-lg tracking-wide" style={{ color: gold }}>
        {verse.reference}
      </p>
      <p className="font-sans text-xs mt-1 uppercase tracking-widest" style={{ color: muted }}>
        {verse.translationName}
      </p>
    </div>
  );
}
