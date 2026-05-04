/**
 * ArchivePage — browse and export past sermons.
 *
 * Left panel: list of sermons (date, title, verse count).
 * Right panel: verses shown during the selected sermon, with export button.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { exportSessionText } from '../lib/bibleApi';

export default function ArchivePage() {
  const { profile, church, signOut } = useAuth();
  const [sermons,  setSermons]  = useState([]);
  const [selected, setSelected] = useState(null);
  const [verses,   setVerses]   = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!church) return;
    supabase
      .from('sermons')
      .select('*, sermon_verses(count)')
      .eq('church_id', church.id)
      .order('sermon_date', { ascending: false })
      .order('created_at', { ascending: false })
      .then(({ data }) => { setSermons(data || []); setLoading(false); });
  }, [church]);

  async function selectSermon(sermon) {
    setSelected(sermon);
    const { data } = await supabase
      .from('sermon_verses')
      .select('*')
      .eq('sermon_id', sermon.id)
      .order('displayed_at');
    setVerses(data || []);
  }

  async function deleteSermon(id) {
    if (!window.confirm('Delete this sermon and all its verses?')) return;
    await supabase.from('sermons').delete().eq('id', id);
    setSermons(s => s.filter(x => x.id !== id));
    if (selected?.id === id) { setSelected(null); setVerses([]); }
  }

  function exportVerses() {
    exportSessionText(verses.map(v => ({
      ...v,
      text:      v.verse_text,
      timestamp: v.displayed_at,
    })));
  }

  const gold = church?.primary_color || '#d4af37';

  return (
    <div className="min-h-screen bg-[#0a1520] text-[#f5ead6] flex flex-col">
      <header className="bg-[#0d1b2a] border-b border-[#1e3050] px-6 py-3 flex items-center gap-4">
        <span className="text-xl select-none" style={{ color: gold }}>✝</span>
        <h1 className="font-serif text-[#f5ead6] text-lg">Sermon Archive</h1>
        <span className="text-[#5a6a7a] font-sans text-sm">{church?.name}</span>
        <div className="ml-auto flex items-center gap-4">
          <Link to="/operator" className="text-[#6a7a8a] hover:text-[#c8b89a] font-sans text-sm transition-colors">← Operator</Link>
          <Link to="/admin"    className="text-[#6a7a8a] hover:text-[#c8b89a] font-sans text-sm transition-colors">Admin</Link>
          <button onClick={signOut} className="text-[#6a7a8a] hover:text-red-400 font-sans text-sm transition-colors">Sign out</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sermon list */}
        <aside className="w-72 bg-[#0d1b2a] border-r border-[#1e3050] flex flex-col overflow-hidden shrink-0">
          <div className="px-4 py-3 border-b border-[#1e3050]">
            <h2 className="text-[#5a6a7a] font-sans text-xs uppercase tracking-wider">Past Sermons</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && <p className="text-[#4a5a6a] font-sans text-sm text-center py-8 animate-pulse">Loading…</p>}
            {!loading && sermons.length === 0 && (
              <p className="text-[#4a5a6a] font-sans text-sm text-center py-8 italic">No sermons archived yet.</p>
            )}
            {sermons.map(s => {
              const count = s.sermon_verses?.[0]?.count ?? 0;
              const isSelected = selected?.id === s.id;
              return (
                <div key={s.id}
                  onClick={() => selectSermon(s)}
                  className={`px-4 py-3 border-b border-[#0f1f2f] cursor-pointer transition-colors ${isSelected ? 'bg-[#1a2a3a]' : 'hover:bg-[#111d2b]'}`}
                  style={isSelected ? { borderLeft: `3px solid ${gold}` } : { borderLeft: '3px solid transparent' }}>
                  <p className="text-[#c8b89a] font-sans text-sm font-medium truncate">{s.title}</p>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[#4a5a6a] font-sans text-xs">
                      {new Date(s.sermon_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    <span className="text-[#3a4a5a] font-sans text-xs">{count} verse{count !== 1 ? 's' : ''}</span>
                  </div>
                  {s.preacher && <p className="text-[#3a4a5a] font-sans text-xs mt-0.5">{s.preacher}</p>}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Verse detail */}
        <main className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-[#3a4a5a] font-serif text-lg italic">Select a sermon to view its verses.</p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="font-serif text-2xl text-[#f5ead6] mb-1">{selected.title}</h2>
                  <p className="text-[#5a6a7a] font-sans text-sm">
                    {new Date(selected.sermon_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    {selected.preacher && ` · ${selected.preacher}`}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {verses.length > 0 && (
                    <button onClick={exportVerses}
                      className="border border-[#243444] text-[#6a7a8a] hover:text-[#c8b89a] font-sans text-xs px-3 py-1.5 rounded-lg transition-colors">
                      Export .txt
                    </button>
                  )}
                  <button onClick={() => deleteSermon(selected.id)}
                    className="border border-red-900 text-red-700 hover:text-red-400 font-sans text-xs px-3 py-1.5 rounded-lg transition-colors">
                    Delete
                  </button>
                </div>
              </div>

              {verses.length === 0 ? (
                <p className="text-[#4a5a6a] font-sans text-sm italic">No verses recorded for this sermon.</p>
              ) : (
                <div className="space-y-4">
                  {verses.map((v, i) => {
                    const isMulti = v.verses?.length > 1;
                    return (
                      <div key={v.id} className="bg-[#0d1b2a] border border-[#1e3050] rounded-xl p-5">
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-sans font-semibold text-sm" style={{ color: gold }}>{v.reference}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-[#4a5a6a] font-sans text-xs uppercase tracking-wider">{v.translation_name}</span>
                            <span className="text-[#3a4a5a] font-sans text-xs">
                              {new Date(v.displayed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                        {isMulti ? (
                          <div className="font-serif text-[#c8b89a] leading-relaxed space-y-2">
                            {v.verses.map(vv => (
                              <p key={vv.verseNumber}>
                                <sup className="font-sans text-[#5a6a7a]" style={{ fontSize: '0.45em', verticalAlign: 'super', marginRight: '0.3em' }}>
                                  {vv.verseNumber}
                                </sup>
                                {vv.text}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="font-serif text-[#c8b89a] leading-relaxed">"{v.verse_text}"</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
