/**
 * ProjectionPage — full-screen display for a second monitor / projector.
 *
 * URL: /projection/:id?fontSize=3
 *   id       — church ID (passed by OperatorPage)
 *   fontSize — 1-5 scale (optional, default 3); maps to clamp sizes below
 *
 * No login required. Subscribes to live_sessions via Supabase realtime.
 */

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const FONT_CLAMP = [
  'clamp(1.1rem, 2.5vw, 2.8rem)',   // 1 – small
  'clamp(1.4rem, 3vw,  3.5rem)',    // 2
  'clamp(1.8rem, 4.5vw, 5rem)',     // 3 – default
  'clamp(2.2rem, 5.5vw, 6rem)',     // 4
  'clamp(2.6rem, 7vw,   7.5rem)',   // 5 – large
];
const REF_CLAMP = [
  'clamp(0.7rem, 1.2vw, 1.4rem)',
  'clamp(0.8rem, 1.5vw, 1.7rem)',
  'clamp(1rem,   2.2vw, 2.2rem)',
  'clamp(1.2rem, 2.8vw, 2.8rem)',
  'clamp(1.4rem, 3.5vw, 3.4rem)',
];

export default function ProjectionPage() {
  const { id: churchId }  = useParams();
  const [params]          = useSearchParams();
  const fsSetting         = Math.min(5, Math.max(1, parseInt(params.get('fontSize') || '3', 10)));

  const [church,  setChurch]  = useState(null);
  const [verse,   setVerse]   = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let channel = null;

    async function init() {
      const { data: ch } = await supabase
        .from('churches').select('*').eq('id', churchId).maybeSingle();
      setChurch(ch);

      const { data: ls } = await supabase
        .from('live_sessions').select('*').eq('church_id', churchId).maybeSingle();
      if (ls && !ls.is_cleared && ls.verse_reference) {
        show({ text: ls.verse_text, reference: ls.verse_reference, translationName: ls.translation_name, verses: ls.verses ?? [] });
      }

      channel = supabase
        .channel(`projection-${churchId}`)
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'live_sessions',
          filter: `church_id=eq.${churchId}`,
        }, payload => {
          const row = payload.new;
          if (row.is_cleared) {
            setVisible(false);
            setTimeout(() => setVerse(null), 500);
          } else if (row.verse_reference) {
            show({ text: row.verse_text, reference: row.verse_reference, translationName: row.translation_name, verses: row.verses ?? [] });
          }
        })
        .subscribe();
    }

    init();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [churchId]);

  function show(v) {
    setVisible(false);
    setTimeout(() => { setVerse(v); setVisible(true); }, 400);
  }

  const gold    = church?.primary_color || '#d4af37';
  const bg      = church?.bg_color      || '#0d1b2a';
  const textCol = church?.text_color    || '#f5ead6';
  const isMulti = verse?.verses?.length > 1;

  const fontClamp = FONT_CLAMP[fsSetting - 1];
  const refClamp  = REF_CLAMP[fsSetting - 1];

  return (
    <div
      className="min-h-screen flex items-center justify-center overflow-hidden select-none"
      style={{ background: bg, color: textCol }}
    >
      {/* ── Verse content ──────────────────────────────────── */}
      <div
        className="text-center px-16 max-w-[88vw] w-full transition-all"
        style={{
          opacity:    visible ? 1 : 0,
          transform:  visible ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.98)',
          transition: 'opacity 0.5s ease, transform 0.5s ease',
        }}
      >
        {verse ? (
          <>
            {isMulti ? (
              <div className="space-y-5 mb-12 font-serif leading-relaxed"
                   style={{ fontSize: fontClamp }}>
                {verse.verses.map(v => (
                  <p key={v.verseNumber}>
                    <sup style={{ fontSize: '0.42em', verticalAlign: 'super', marginRight: '0.35em', color: '#6a7a8a' }}>
                      {v.verseNumber}
                    </sup>
                    {v.text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="font-serif leading-relaxed mb-12"
                 style={{ fontSize: fontClamp }}>
                "{verse.text}"
              </p>
            )}

            <p className="font-sans font-semibold tracking-widest"
               style={{ fontSize: refClamp, color: gold }}>
              {verse.reference}
            </p>
            <p className="font-sans uppercase tracking-widest mt-3"
               style={{ fontSize: `clamp(0.55rem, 0.9vw, 0.9rem)`, color: '#3a4a5a' }}>
              {verse.translationName}
            </p>
          </>
        ) : (
          /* Idle — shown only when no verse is live */
          <div style={{ opacity: 0.18 }}>
            {church?.logo_url
              ? <img src={church.logo_url} alt={church?.name}
                     style={{ height: '6vh', margin: '0 auto 2vh', filter: 'brightness(0) invert(1)' }} />
              : <div style={{ fontSize: 'clamp(3rem, 8vw, 8rem)', color: gold, marginBottom: '2vh' }}>✝</div>
            }
            <p className="font-sans uppercase tracking-[0.3em]"
               style={{ fontSize: 'clamp(0.6rem, 1.2vw, 1.2rem)', color: textCol }}>
              {church?.name || 'Bible Display'}
            </p>
          </div>
        )}
      </div>

      {/* ── Watermark ──────────────────────────────────────── */}
      <div
        className="fixed bottom-5 right-7 font-sans uppercase tracking-widest"
        style={{ fontSize: '0.55rem', color: '#16222e' }}
      >
        {church?.name || 'Bible Display'}
      </div>
    </div>
  );
}
