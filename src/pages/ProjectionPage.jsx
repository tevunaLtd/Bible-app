/**
 * ProjectionPage — full-screen display for a second monitor / projector.
 *
 * URL: /projection/:id  (church ID, passed by OperatorPage when opening the window)
 *
 * No login required. Subscribes to live_sessions via Supabase realtime.
 * Applies church white-label colours.
 */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function ProjectionPage() {
  const { id: churchId } = useParams();
  const [church,  setChurch]  = useState(null);
  const [verse,   setVerse]   = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let channel = null;

    async function init() {
      const { data: ch } = await supabase.from('churches').select('*').eq('id', churchId).maybeSingle();
      setChurch(ch);

      const { data: ls } = await supabase.from('live_sessions').select('*').eq('church_id', churchId).maybeSingle();
      if (ls && !ls.is_cleared && ls.verse_reference) {
        show({ text: ls.verse_text, reference: ls.verse_reference, translationName: ls.translation_name, verses: ls.verses ?? [] });
      }

      channel = supabase
        .channel(`projection-${churchId}`)
        .on('postgres_changes', {
          event:  'UPDATE', schema: 'public', table: 'live_sessions',
          filter: `church_id=eq.${churchId}`,
        }, payload => {
          const row = payload.new;
          if (row.is_cleared) { setVisible(false); setTimeout(() => setVerse(null), 400); }
          else if (row.verse_reference) {
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
    setTimeout(() => { setVerse(v); setVisible(true); }, 350);
  }

  const gold    = church?.primary_color || '#d4af37';
  const bg      = church?.bg_color      || '#0d1b2a';
  const textCol = church?.text_color    || '#f5ead6';
  const isMulti = verse?.verses?.length > 1;

  return (
    <div
      className="min-h-screen flex items-center justify-center overflow-hidden"
      style={{ background: bg, color: textCol }}
    >
      <div
        className="text-center px-16 max-w-[90vw] transition-all duration-500"
        style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(14px)' }}
      >
        {verse && (
          <>
            {isMulti ? (
              <div className="space-y-4 mb-10 font-serif leading-relaxed"
                   style={{ fontSize: 'clamp(1.6rem, 4vw, 4.5rem)' }}>
                {verse.verses.map(v => (
                  <p key={v.verseNumber}>
                    <sup className="font-sans" style={{ fontSize: '0.42em', verticalAlign: 'super', marginRight: '0.35em', color: '#8a9aaa' }}>
                      {v.verseNumber}
                    </sup>
                    {v.text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="font-serif leading-relaxed mb-10"
                 style={{ fontSize: 'clamp(1.8rem, 4.5vw, 5rem)' }}>
                "{verse.text}"
              </p>
            )}
            <p className="font-sans font-semibold tracking-widest"
               style={{ fontSize: 'clamp(1rem, 2.2vw, 2.2rem)', color: gold }}>
              {verse.reference}
            </p>
            <p className="font-sans uppercase tracking-widest mt-2"
               style={{ fontSize: 'clamp(0.6rem, 1vw, 1rem)', color: '#5a6a7a' }}>
              {verse.translationName}
            </p>
          </>
        )}
      </div>

      {/* Watermark */}
      <div className="fixed bottom-4 right-6 font-sans uppercase tracking-widest"
           style={{ fontSize: '0.6rem', color: '#1e2e3e' }}>
        {church?.name || 'Bible Display'}
      </div>
    </div>
  );
}
