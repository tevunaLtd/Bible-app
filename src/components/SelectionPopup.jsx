/**
 * SelectionPopup — floats above a text selection.
 *
 * Shows a loading spinner while Claude detects the reference, then
 * displays a verse preview with "Display" and dismiss buttons.
 *
 * Props:
 *   popup     — { x, y, text, loading, verse } | null
 *   onDisplay — (verse) => void
 *   onDismiss — () => void
 *   colors    — { primary } from church settings
 */
import { useEffect, useRef } from 'react';

export default function SelectionPopup({ popup, onDisplay, onDismiss, colors }) {
  const popupRef = useRef(null);
  const gold = colors?.primary || '#d4af37';

  // Close on Escape
  useEffect(() => {
    if (!popup) return;
    function onKey(e) { if (e.key === 'Escape') onDismiss(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popup, onDismiss]);

  if (!popup) return null;

  // Clamp so popup stays inside the viewport (12px padding)
  const popupW = 340;
  const PADDING = 12;
  let left = popup.x - popupW / 2;
  if (left < PADDING) left = PADDING;
  if (left + popupW > window.innerWidth - PADDING) left = window.innerWidth - popupW - PADDING;

  const style = {
    position: 'fixed',
    left: `${left}px`,
    top: `${popup.y - 12}px`,
    transform: 'translateY(-100%)',
    width: `${popupW}px`,
    zIndex: 200,
  };

  const isMulti = popup.verse?.verses?.length > 1;

  return (
    <div ref={popupRef} style={style} data-selection-popup="true"
      className="bg-[#141f2e] border border-[#2a3a4e] rounded-2xl shadow-2xl overflow-hidden"
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Arrow */}
      <div style={{ position: 'absolute', bottom: -7, left: '50%', transform: 'translateX(-50%)' }}>
        <div style={{ width: 14, height: 7, overflow: 'hidden' }}>
          <div style={{ width: 10, height: 10, background: '#2a3a4e', transform: 'rotate(45deg)', margin: '-5px auto 0' }} />
        </div>
      </div>

      {/* Selected text pill */}
      <div className="px-4 pt-3 pb-2 border-b border-[#1e2e3e]">
        <p className="font-sans text-xs text-[#4a5a6a] truncate">
          <span className="bg-[#d4af37]/20 text-[#d4af37] rounded px-1 py-0.5 mr-1 text-[10px] uppercase tracking-wider font-semibold">Selected</span>
          {popup.text.length > 70 ? popup.text.slice(0, 70) + '…' : popup.text}
        </p>
      </div>

      <div className="px-4 py-3">
        {popup.loading ? (
          <div className="flex items-center gap-2 py-1">
            <span className="w-3.5 h-3.5 border-2 border-[#d4af37]/30 border-t-[#d4af37] rounded-full animate-spin shrink-0" />
            <p className="text-[#5a6a7a] font-sans text-sm">Detecting reference…</p>
          </div>
        ) : popup.verse ? (
          <>
            {/* Reference */}
            <p className="font-sans font-semibold text-base mb-2" style={{ color: gold }}>
              {popup.verse.reference}
              <span className="ml-2 font-sans text-xs font-normal text-[#4a5a6a] uppercase tracking-wider">
                {popup.verse.translationName}
              </span>
            </p>

            {/* Verse preview */}
            {isMulti ? (
              <div className="font-serif text-sm leading-relaxed text-[#c8b89a] mb-3 space-y-1 max-h-32 overflow-y-auto">
                {popup.verse.verses.map(v => (
                  <p key={v.verseNumber}>
                    <sup className="font-sans text-[#6a7a8a]" style={{ fontSize: '0.6em', marginRight: '0.25em' }}>
                      {v.verseNumber}
                    </sup>
                    {v.text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="font-serif text-sm leading-relaxed text-[#c8b89a] mb-3 line-clamp-4">
                "{popup.verse.text}"
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => onDisplay(popup.verse)}
                className="flex-1 font-sans font-semibold text-sm py-2 rounded-xl transition-colors"
                style={{ background: gold, color: '#0d1b2a' }}
              >
                Display on screen
              </button>
              <button
                onClick={onDismiss}
                className="px-3 py-2 rounded-xl font-sans text-sm text-[#6a7a8a] hover:text-[#c8b89a] border border-[#2a3a4a] hover:border-[#3a4a5a] transition-colors"
              >
                ✕
              </button>
            </div>
          </>
        ) : (
          <p className="text-[#4a5a6a] font-sans text-sm italic py-1">No reference found in selection.</p>
        )}
      </div>
    </div>
  );
}
