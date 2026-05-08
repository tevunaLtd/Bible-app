/**
 * ProjectionPreview — live 16:9 screen preview inside the operator interface.
 *
 * Props:
 *   verse        — current verse object | null
 *   church       — church row (colors, name, logo)
 *   fontSize     — 1–5 scale (default 3)
 *   onFontChange — (delta: -1 | 1) => void
 *   onClear      — () => void
 *   onOpen       — () => void  (opens full-screen window)
 */
export default function ProjectionPreview({ verse, church, fontSize = 3, onFontChange, onClear, onOpen, isProjecting = false }) {
  const gold    = church?.primary_color || '#d4af37';
  const bg      = church?.bg_color      || '#0d1b2a';
  const textCol = church?.text_color    || '#f5ead6';
  const isMulti = verse?.verses?.length > 1;

  // Map 1-5 scale to em values for the scaled-down preview
  const FONT_SIZES = ['0.55rem', '0.7rem', '0.88rem', '1.05rem', '1.28rem'];
  const REF_SIZES  = ['0.4rem',  '0.5rem', '0.6rem',  '0.72rem', '0.84rem'];
  const fs = FONT_SIZES[fontSize - 1];
  const rs = REF_SIZES[fontSize - 1];

  return (
    <div className="flex flex-col h-full border-l border-[#1e3050] bg-[#08111a]">

      {/* ── Controls bar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e3050] shrink-0">
        <div className="flex items-center gap-2">
          {isProjecting && (
            <span className="flex items-center gap-1 bg-red-950 border border-red-800 px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              <span className="font-sans text-[9px] font-bold uppercase tracking-widest text-red-300">Live</span>
            </span>
          )}
          <span className={`w-2 h-2 rounded-full ${verse ? 'bg-green-400 animate-pulse' : 'bg-[#2a3a4a]'}`} />
          <span className="font-sans text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: verse ? '#8a9aaa' : '#3a4a5a' }}>
            {verse ? 'On screen' : 'Standby'}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          {/* Font size */}
          <button onClick={() => onFontChange(-1)} disabled={fontSize <= 1}
            className="w-7 h-7 flex items-center justify-center rounded font-sans text-xs font-bold disabled:opacity-25 transition-colors text-[#5a6a7a] hover:text-[#c8b89a] hover:bg-[#1a2a3a]"
            title="Smaller text">A−</button>
          <span className="font-sans text-[10px] text-[#3a4a5a] w-3 text-center">{fontSize}</span>
          <button onClick={() => onFontChange(1)} disabled={fontSize >= 5}
            className="w-7 h-7 flex items-center justify-center rounded font-sans text-xs font-bold disabled:opacity-25 transition-colors text-[#5a6a7a] hover:text-[#c8b89a] hover:bg-[#1a2a3a]"
            title="Larger text">A+</button>

          <span className="text-[#1e2e3e] mx-1 select-none">│</span>

          <button onClick={onClear} disabled={!verse}
            className="px-2 py-1 rounded font-sans text-xs transition-colors text-[#5a6a7a] hover:text-red-400 hover:bg-red-950/30 disabled:opacity-25"
            title="Clear screen">
            Clear
          </button>

          <button onClick={onOpen}
            className="px-2 py-1 rounded font-sans text-xs font-semibold transition-colors hover:bg-[#1a2a3a]"
            style={{ color: gold }}
            title="Open full-screen projection window">
            ↗ Full screen
          </button>
        </div>
      </div>

      {/* ── 16:9 screen frame ────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        <div className="w-full" style={{ maxHeight: '100%' }}>
          {/* padding-bottom trick preserves 16:9 ratio */}
          <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
            <div
              className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden"
              style={{
                background: bg,
                borderRadius: 3,
                boxShadow: `0 0 0 1px #1e3050, 0 0 0 4px #0a1016, 0 12px 40px rgba(0,0,0,0.7)`,
                padding: '5%',
              }}
            >
              {verse ? (
                <div className="w-full flex flex-col items-center justify-center gap-0" style={{ maxHeight: '100%', overflow: 'hidden' }}>
                  {isMulti ? (
                    <div style={{
                      color: textCol, fontFamily: 'Georgia, serif',
                      fontSize: fs, lineHeight: 1.55, textAlign: 'center',
                      marginBottom: '5%', overflowY: 'auto', maxHeight: '72%', width: '100%',
                    }}>
                      {verse.verses.map(v => (
                        <p key={v.verseNumber} style={{ marginBottom: '0.35em' }}>
                          <sup style={{ fontSize: '0.6em', color: '#5a6a7a', marginRight: '0.25em' }}>{v.verseNumber}</sup>
                          {v.text}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p style={{
                      color: textCol, fontFamily: 'Georgia, serif',
                      fontSize: fs, lineHeight: 1.55, textAlign: 'center',
                      marginBottom: '5%',
                    }}>
                      "{verse.text}"
                    </p>
                  )}

                  <p style={{
                    color: gold, fontFamily: 'sans-serif',
                    fontSize: rs, fontWeight: 700,
                    letterSpacing: '0.1em', textAlign: 'center',
                  }}>
                    {verse.reference}
                  </p>
                  <p style={{
                    color: '#3a4a5a', fontFamily: 'sans-serif',
                    fontSize: `calc(${rs} * 0.75)`,
                    letterSpacing: '0.18em', textTransform: 'uppercase',
                    marginTop: '1.5%',
                  }}>
                    {verse.translationName}
                  </p>
                </div>
              ) : (
                /* Idle state */
                <div style={{ textAlign: 'center' }}>
                  {church?.logo_url
                    ? <img src={church.logo_url} alt={church?.name} style={{ height: '12%', maxHeight: 32, margin: '0 auto 6%', opacity: 0.35 }} />
                    : <div style={{ fontSize: `calc(${rs} * 2)`, color: gold + '25', marginBottom: '5%' }}>✝</div>
                  }
                  <p style={{
                    color: '#1e3050', fontFamily: 'sans-serif',
                    fontSize: `calc(${rs} * 0.8)`, letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                  }}>
                    {church?.name || 'Bible Display'}
                  </p>
                </div>
              )}

              {/* Watermark */}
              <div style={{
                position: 'absolute', bottom: '2.5%', right: '2.5%',
                fontFamily: 'sans-serif', fontSize: `calc(${rs} * 0.55)`,
                color: '#18283a', letterSpacing: '0.15em', textTransform: 'uppercase',
              }}>
                {church?.name || 'Bible Display'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Verse info strip ─────────────────────────────────── */}
      {verse && (
        <div className="px-3 py-2 border-t border-[#1e3050] shrink-0 flex items-center justify-between">
          <span className="font-sans text-xs font-semibold" style={{ color: gold }}>{verse.reference}</span>
          <span className="font-sans text-[10px] uppercase tracking-wider text-[#3a4a5a]">{verse.translationName}</span>
        </div>
      )}
    </div>
  );
}
