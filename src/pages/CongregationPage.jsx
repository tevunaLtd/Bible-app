/**
 * CongregationPage — public, no login required.
 *
 * URL: /c/:slug
 *
 * Members open this on their phone or tablet during the service.
 * It subscribes to Supabase realtime on the live_sessions table and
 * displays the current verse in the church's white-label colours.
 */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function CongregationPage() {
  const { slug } = useParams();
  const [church,  setChurch]  = useState(null);
  const [verse,   setVerse]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Load church by slug, then subscribe to live_sessions
  useEffect(() => {
    let channel = null;

    async function init() {
      const { data: ch, error: chErr } = await supabase
        .from('churches')
        .select('*')
        .eq('slug', slug)
        .single();

      if (chErr || !ch) { setError('Church not found.'); setLoading(false); return; }
      setChurch(ch);

      // maybeSingle() returns null (not an error) when no row exists yet
      const { data: ls } = await supabase
        .from('live_sessions')
        .select('*')
        .eq('church_id', ch.id)
        .maybeSingle();

      if (ls && !ls.is_cleared && ls.verse_reference) {
        setVerse({ text: ls.verse_text, reference: ls.verse_reference, translationName: ls.translation_name, verses: ls.verses ?? [] });
      }
      setLoading(false);

      // Subscribe to real-time updates
      channel = supabase
        .channel(`congregation-${ch.id}`)
        .on('postgres_changes', {
          event:  'UPDATE',
          schema: 'public',
          table:  'live_sessions',
          filter: `church_id=eq.${ch.id}`,
        }, payload => {
          const row = payload.new;
          if (row.is_cleared) setVerse(null);
          else if (row.verse_reference) {
            setVerse({ text: row.verse_text, reference: row.verse_reference, translationName: row.translation_name, verses: row.verses ?? [] });
          }
        })
        .subscribe();
    }

    init();

    // Cleanup runs when component unmounts or slug changes
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [slug]);

  const gold    = church?.primary_color || '#d4af37';
  const bg      = church?.bg_color      || '#0d1b2a';
  const textCol = church?.text_color    || '#f5ead6';
  const muted   = '#6a7a8a';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: bg }}>
        <span className="font-serif text-xl animate-pulse" style={{ color: gold }}>Loading…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: bg }}>
        <p className="font-sans text-red-400">{error}</p>
      </div>
    );
  }

  const isMulti = verse?.verses?.length > 1;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: bg, color: textCol }}>
      {/* Church header */}
      <header className="px-6 py-4 flex items-center gap-3 border-b" style={{ borderColor: '#1e3050' }}>
        {church.logo_url
          ? <img src={church.logo_url} alt={church.name} className="h-8 w-auto" />
          : <span className="text-2xl select-none" style={{ color: gold }}>✝</span>
        }
        <span className="font-serif text-lg" style={{ color: textCol }}>{church.name}</span>
        <span className="ml-auto font-sans text-xs px-2 py-0.5 rounded-full border animate-pulse"
          style={{ color: gold, borderColor: gold + '40', background: gold + '15' }}>
          LIVE
        </span>
      </header>

      {/* Verse area */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        {verse ? (
          <>
            {isMulti ? (
              <div className="space-y-4 max-w-2xl mb-8 text-2xl sm:text-3xl font-serif leading-relaxed">
                {verse.verses.map(v => (
                  <p key={v.verseNumber}>
                    <sup className="font-sans" style={{ fontSize: '0.45em', verticalAlign: 'super', marginRight: '0.3em', color: '#8a9aaa' }}>
                      {v.verseNumber}
                    </sup>
                    {v.text}
                  </p>
                ))}
              </div>
            ) : (
              <blockquote className="text-2xl sm:text-3xl font-serif leading-relaxed mb-8 max-w-2xl">
                "{verse.text}"
              </blockquote>
            )}
            <p className="font-sans font-semibold text-xl tracking-wide" style={{ color: gold }}>{verse.reference}</p>
            <p className="font-sans text-xs mt-2 uppercase tracking-widest" style={{ color: muted }}>{verse.translationName}</p>
          </>
        ) : (
          <div className="text-center">
            <p className="text-5xl mb-6 select-none" style={{ color: gold + '40' }}>✝</p>
            <p className="font-serif text-xl italic" style={{ color: muted }}>
              Waiting for the next scripture…
            </p>
            <p className="font-sans text-xs mt-3" style={{ color: '#3a4a5a' }}>
              {church.name} · Follow along
            </p>
          </div>
        )}
      </main>

      <footer className="text-center py-3 font-sans text-xs" style={{ color: '#2a3a4a' }}>
        Bible Display
      </footer>
    </div>
  );
}
