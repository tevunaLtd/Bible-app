/**
 * OperatorPage — the main operator/preacher interface.
 *
 * Key differences from the old single-file app:
 *   • API keys come from church settings in Supabase (not localStorage)
 *   • Every verse update is written to live_sessions (multi-device + congregation)
 *   • All verses are saved to the current sermon's sermon_verses
 *   • Congregation URL panel lets the operator share the link or open projection
 *   • White-label colours applied from church settings
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  fetchVerseContent, loadTranslationList, formatReference,
  buildTranscriptContext, buildPassageContext, exportSessionText,
  findLastVerse,
} from '../lib/bibleApi';
import { claudeDetectReferences, claudeGenerateCrossRefs } from '../lib/claudeApi';
import {
  CONFIDENCE_THRESHOLD, TRANSCRIPT_WINDOW_MS, MAX_CONTEXT_PASSAGES,
  CHUNK_WORD_LIMIT, CHUNK_SILENCE_MS, FREE_TRANSLATIONS, CHAPTER_COUNTS,
} from '../lib/constants';
import VerseDisplay          from '../components/VerseDisplay';
import CrossReferencePanel   from '../components/CrossReferencePanel';
import DisambiguationModal   from '../components/DisambiguationModal';
import SelectionPopup        from '../components/SelectionPopup';
import ProjectionPreview     from '../components/ProjectionPreview';

export default function OperatorPage() {
  const { profile, church, signOut } = useAuth();

  // ── Verse state ───────────────────────────────────────────
  const [currentVerse,   setCurrentVerse]   = useState(null);
  const [isLoadingVerse, setIsLoadingVerse] = useState(false);
  const [crossRefs,      setCrossRefs]      = useState([]);
  const [isLoadingXRefs, setIsLoadingXRefs] = useState(false);
  const [disambigQueue,  setDisambigQueue]  = useState([]);

  // ── Translations ──────────────────────────────────────────
  const [translations,        setTranslations]        = useState(FREE_TRANSLATIONS);
  const [selectedTranslation, setSelectedTranslation] = useState(FREE_TRANSLATIONS[0]);

  // ── Sermon ────────────────────────────────────────────────
  const [sermon,     setSermon]     = useState(null); // current Supabase sermon row
  const [sermonTitle, setSermonTitle] = useState('');

  // ── Voice ─────────────────────────────────────────────────
  const [isListening,    setIsListening]    = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isProcessingNLP, setIsProcessingNLP] = useState(false);

  // ── UI ────────────────────────────────────────────────────
  const [displayMode,      setDisplayMode]      = useState('projection');
  const [activeTab,        setActiveTab]        = useState('display');
  const [manualInput,      setManualInput]      = useState('');
  const [isManualLoading,  setIsManualLoading]  = useState(false);
  const [error,            setError]            = useState(null);
  const [session,          setSession]          = useState([]);
  const [showCongLink,     setShowCongLink]     = useState(false);
  const [copied,           setCopied]           = useState(false);
  const [showSettings,     setShowSettings]     = useState(false);
  const [settingsAnthKey,  setSettingsAnthKey]  = useState('');
  const [settingsBibleKey, setSettingsBibleKey] = useState('');
  const [settingsSaving,   setSettingsSaving]   = useState(false);
  const [settingsSaved,    setSettingsSaved]    = useState(false);
  const [selectionPopup,   setSelectionPopup]   = useState(null);
  const [projFontSize,     setProjFontSize]     = useState(3);
  const [isProjecting,     setIsProjecting]     = useState(false);

  // ── Refs ──────────────────────────────────────────────────
  const recognitionRef      = useRef(null);
  const transcriptChunksRef = useRef([]);
  const passageContextRef   = useRef([]);
  const processingLockRef   = useRef(false);
  const chunkBufferRef      = useRef('');
  const chunkTimerRef       = useRef(null);
  const currentVerseRef     = useRef(null);
  const broadcastRef        = useRef(null);
  const projWindowRef       = useRef(null);
  const projCheckRef        = useRef(null);
  currentVerseRef.current = currentVerse; // always reflects latest render

  // ── BroadcastChannel — projection sync across tabs ────────
  useEffect(() => {
    const bc = new BroadcastChannel('bible-live');
    broadcastRef.current = bc;
    return () => {
      bc.close();
      broadcastRef.current = null;
      clearInterval(projCheckRef.current);
    };
  }, []);

  const congUrl      = church ? `${window.location.origin}/c/${church.slug}` : '';
  const projUrl      = church ? `${window.location.origin}/projection/${church.id}?fontSize=${projFontSize}` : '';
  const colors       = { primary: church?.primary_color, bg: church?.bg_color, text: church?.text_color };
  const anthropicKey = church?.anthropic_key || localStorage.getItem('bible_app_anthropic_key') || '';

  function openProjectionWindow() {
    const win = window.open(projUrl, 'projection', 'width=1920,height=1080,menubar=no,toolbar=no,location=no,status=no');
    projWindowRef.current = win;
    setIsProjecting(true);
    clearInterval(projCheckRef.current);
    projCheckRef.current = setInterval(() => {
      if (!projWindowRef.current || projWindowRef.current.closed) {
        setIsProjecting(false);
        projWindowRef.current = null;
        clearInterval(projCheckRef.current);
      }
    }, 1000);
    // Re-send current verse once the projection page has mounted its BroadcastChannel listener
    if (currentVerseRef.current) {
      setTimeout(() => {
        broadcastRef.current?.postMessage({ type: 'verse', verse: currentVerseRef.current });
      }, 1200);
    }
  }

  // ── Auto-open settings if no API key found ────────────────
  useEffect(() => {
    if (!church?.anthropic_key && !localStorage.getItem('bible_app_anthropic_key')) {
      setShowSettings(true);
    }
  }, [church]);

  // ── Load translations + create/load sermon on mount ──────
  useEffect(() => {
    if (!church) return;

    loadTranslationList(church.apibible_key).then(list => {
      setTranslations(list);
      if (church.default_translation) {
        const found = list.find(t => t.id === church.default_translation);
        if (found) setSelectedTranslation(found);
      }
    });

    // Create a sermon for today (or find existing one from today)
    const today = new Date().toISOString().split('T')[0];
    supabase
      .from('sermons')
      .select('*')
      .eq('church_id', church.id)
      .eq('sermon_date', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(async ({ data }) => {
        if (data?.length) {
          setSermon(data[0]);
          setSermonTitle(data[0].title);
        } else {
          const title = `Sermon — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
          const { data: newSermon } = await supabase
            .from('sermons')
            .insert({ church_id: church.id, title })
            .select()
            .single();
          setSermon(newSermon);
          setSermonTitle(newSermon?.title ?? title);
        }
      });
  }, [church]);

  // ── Persist sermon title change (debounced) ───────────────
  const titleTimerRef = useRef(null);
  function handleTitleChange(val) {
    setSermonTitle(val);
    clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(async () => {
      if (sermon?.id) {
        await supabase.from('sermons').update({ title: val }).eq('id', sermon.id);
      }
    }, 800);
  }

  // ── Push verse to live_sessions + sermon_verses ──────────
  const pushVerseToSupabase = useCallback(async (verse) => {
    if (!church) return;
    // live_sessions: upsert (the row is created once in SetupPage)
    await supabase.from('live_sessions').upsert({
      church_id:       church.id,
      verse_text:      verse.text,
      verse_reference: verse.reference,
      translation_name: verse.translationName,
      verses:          verse.verses ?? [],
      is_cleared:      false,
      updated_at:      new Date().toISOString(),
    }, { onConflict: 'church_id' });

    // sermon_verses: append
    if (sermon?.id) {
      await supabase.from('sermon_verses').insert({
        sermon_id:       sermon.id,
        reference:       verse.reference,
        book:            verse.book,
        chapter:         verse.chapter,
        verse_start:     verse.verseStart,
        verse_end:       verse.verseEnd,
        verse_text:      verse.text,
        verses:          verse.verses ?? [],
        translation_name: verse.translationName,
      });
    }
  }, [church, sermon]);

  // ── Load and display verse ────────────────────────────────
  const loadAndDisplayVerse = useCallback(async (ref) => {
    if (processingLockRef.current) return;
    processingLockRef.current = true;
    setIsLoadingVerse(true);
    setError(null);
    try {
      const result    = await fetchVerseContent(church?.apibible_key, selectedTranslation, ref.book, ref.chapter, ref.verseStart, ref.verseEnd);
      const reference = formatReference(ref);
      const verse = {
        book: ref.book, chapter: ref.chapter,
        verseStart: ref.verseStart, verseEnd: ref.verseEnd ?? ref.verseStart,
        text: result.text, verses: result.verses,
        reference, translationName: selectedTranslation.name,
        timestamp: Date.now(),
      };
      setCurrentVerse(verse);
      broadcastRef.current?.postMessage({ type: 'verse', verse });
      setSession(prev => [...prev, verse]);
      passageContextRef.current = [...passageContextRef.current, verse].slice(-MAX_CONTEXT_PASSAGES);
      processingLockRef.current = false; // release early — Supabase write doesn't need the lock
      pushVerseToSupabase(verse);        // fire-and-forget

      // Cross-refs — async, non-blocking
      setIsLoadingXRefs(true);
      setCrossRefs([]);
      claudeGenerateCrossRefs(anthropicKey, reference, result.text)
        .then(async xrefData => {
          const enriched = await Promise.allSettled(
            (xrefData.crossReferences ?? []).map(async xref => {
              try {
                const r = await fetchVerseContent(church?.apibible_key, selectedTranslation, xref.book, xref.chapter, xref.verseStart, xref.verseEnd);
                return { ...xref, text: r.text };
              } catch { return xref; }
            })
          );
          setCrossRefs(enriched.filter(r => r.status === 'fulfilled').map(r => r.value));
        })
        .catch(err => console.warn('Cross-ref error:', err.message))
        .finally(() => setIsLoadingXRefs(false));

    } catch (err) {
      const notFound = /404|not found|no verse|failed to fetch|networkerror/i.test(err.message);
      setError(notFound
        ? `${formatReference(ref)} is not available.`
        : `Could not load verse: ${err.message}`
      );
    } finally {
      setIsLoadingVerse(false);
      processingLockRef.current = false;
    }
  }, [church, selectedTranslation, pushVerseToSupabase]);

  // ── Navigation commands ───────────────────────────────────
  const NAV_PATTERNS = [
    { re: /\bnext\s+chapter\b/i,                            action: 'nextChapter'  },
    { re: /\b(?:previous|prev|go\s+back\s+a?)\s+chapter\b/i, action: 'prevChapter' },
    { re: /\b(?:last|final)\s+chapter\b/i,                  action: 'lastChapter'  },
    { re: /\bfirst\s+chapter\b/i,                           action: 'firstChapter' },
    { re: /\bnext\s+verse\b/i,                              action: 'nextVerse'    },
    { re: /\b(?:previous|prev)\s+verse\b/i,                 action: 'prevVerse'    },
    { re: /\b(?:last|final)\s+verse\b/i,                    action: 'lastVerse'    },
    { re: /\bfirst\s+verse\b/i,                             action: 'firstVerse'   },
    { re: /^\s*next\s*$/i,                                  action: 'nextVerse'    },
    { re: /^\s*(?:previous|prev|go\s+back)\s*$/i,           action: 'prevVerse'    },
  ];

  function resolveNavRef(action, verse) {
    if (!verse) return null;
    const { book, chapter, verseStart } = verse;
    if (action === 'nextVerse')    return { book, chapter, verseStart: verseStart + 1 };
    if (action === 'prevVerse')    return { book, chapter, verseStart: Math.max(1, verseStart - 1) };
    if (action === 'firstVerse')   return { book, chapter, verseStart: 1 };
    if (action === 'nextChapter')  return { book, chapter: chapter + 1, verseStart: 1 };
    if (action === 'prevChapter')  return { book, chapter: Math.max(1, chapter - 1), verseStart: 1 };
    if (action === 'firstChapter') return { book, chapter: 1, verseStart: 1 };
    if (action === 'lastChapter')  return { book, chapter: CHAPTER_COUNTS[book] ?? chapter, verseStart: 1 };
    // 'lastVerse' is handled asynchronously in the callers
    return null;
  }

  async function resolveLastVerse(verse) {
    if (!verse) return null;
    const last = await findLastVerse(church?.apibible_key, selectedTranslation, verse.book, verse.chapter);
    return { book: verse.book, chapter: verse.chapter, verseStart: last };
  }

  // ── NLP ───────────────────────────────────────────────────
  const processChunk = useCallback(async (chunk) => {
    if (!chunk.trim() || !anthropicKey) return;

    // Check for navigation commands first — no (or one) API call needed
    for (const { re, action } of NAV_PATTERNS) {
      if (re.test(chunk)) {
        const nav = action === 'lastVerse'
          ? await resolveLastVerse(currentVerseRef.current)
          : resolveNavRef(action, currentVerseRef.current);
        if (nav) { await loadAndDisplayVerse(nav); return; }
        break;
      }
    }

    setIsProcessingNLP(true);
    try {
      const result = await claudeDetectReferences(
        anthropicKey,
        buildTranscriptContext(transcriptChunksRef.current, TRANSCRIPT_WINDOW_MS),
        buildPassageContext(passageContextRef.current, MAX_CONTEXT_PASSAGES),
        chunk
      );
      for (const ref of result.references ?? []) {
        if (ref.confidence >= CONFIDENCE_THRESHOLD) { await loadAndDisplayVerse(ref); break; }
        else if (ref.confidence >= 0.5) setDisambigQueue(prev => [...prev, ref]);
      }
    } catch (err) { console.warn('NLP error:', err.message); }
    finally { setIsProcessingNLP(false); }
  }, [church, loadAndDisplayVerse]);

  const flushChunkBuffer = useCallback(() => {
    const chunk = chunkBufferRef.current.trim();
    if (!chunk) return;
    chunkBufferRef.current = '';
    const now = Date.now();
    transcriptChunksRef.current.push({ text: chunk, timestamp: now });
    transcriptChunksRef.current = transcriptChunksRef.current.filter(c => c.timestamp > now - TRANSCRIPT_WINDOW_MS);
    processChunk(chunk);
  }, [processChunk]);

  // ── Voice recognition ─────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) { setError('Speech recognition requires Chrome or Edge.'); return; }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    recognitionRef.current = rec;
    rec.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const spoken = event.results[i][0].transcript;
          chunkBufferRef.current += ' ' + spoken;
          setLiveTranscript(prev => prev + ' ' + spoken);
          clearTimeout(chunkTimerRef.current);
          chunkTimerRef.current = setTimeout(flushChunkBuffer, CHUNK_SILENCE_MS);
          if (chunkBufferRef.current.trim().split(/\s+/).length >= CHUNK_WORD_LIMIT) flushChunkBuffer();
        }
      }
    };
    rec.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') setError(`Mic: ${e.error}`); };
    rec.onend   = () => { if (recognitionRef.current === rec) try { rec.start(); } catch {} };
    rec.start();
    setIsListening(true);
  }, [flushChunkBuffer]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    clearTimeout(chunkTimerRef.current);
    flushChunkBuffer();
    setIsListening(false);
  }, [flushChunkBuffer]);

  // ── Clear display ─────────────────────────────────────────
  async function clearDisplay() {
    setCurrentVerse(null);
    broadcastRef.current?.postMessage({ type: 'clear' });
    if (church) {
      await supabase.from('live_sessions').upsert(
        { church_id: church.id, is_cleared: true, updated_at: new Date().toISOString() },
        { onConflict: 'church_id' }
      );
    }
  }

  // ── Manual lookup ─────────────────────────────────────────
  async function handleManualSubmit(e) {
    e.preventDefault();
    const input = manualInput.trim();
    if (!input || isManualLoading) return;

    // Navigation commands — no Anthropic key needed
    for (const { re, action } of NAV_PATTERNS) {
      if (re.test(input)) {
        const nav = action === 'lastVerse'
          ? await resolveLastVerse(currentVerseRef.current)
          : resolveNavRef(action, currentVerseRef.current);
        if (nav) { await loadAndDisplayVerse(nav); setManualInput(''); }
        else setError('No verse loaded yet — load a verse first to navigate.');
        return;
      }
    }

    setIsManualLoading(true); setError(null);
    try {
      const result = await claudeDetectReferences(anthropicKey, '', '', input);
      const refs = result.references ?? [];
      if (!refs.length) setError(`Could not parse "${input}" as a Bible reference.`);
      else { await loadAndDisplayVerse(refs[0]); setManualInput(''); }
    } catch (err) { setError(`Lookup failed: ${err.message}`); }
    finally { setIsManualLoading(false); }
  }

  // ── Cross-ref click-through ───────────────────────────────
  function handleSelectCrossRef(ref) {
    if (ref.text) {
      const verse = { ...ref, text: ref.text, verses: [], translationName: selectedTranslation.name, timestamp: Date.now() };
      setCurrentVerse(verse); setActiveTab('display');
      pushVerseToSupabase(verse);
    } else {
      loadAndDisplayVerse({ book: ref.book, chapter: ref.chapter, verseStart: ref.verseStart, verseEnd: ref.verseEnd });
    }
  }

  // ── Text-selection → verse preview ───────────────────────
  async function handleMouseUp(e) {
    // Ignore clicks inside inputs/buttons/the popup itself
    const tag = e.target?.tagName;
    if (['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(tag)) return;
    if (e.target?.closest?.('[data-selection-popup]')) return;

    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text || text.length < 4) { setSelectionPopup(null); return; }
    if (!anthropicKey) return;

    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range) return;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const x = rect.left + rect.width / 2;
    const y = rect.top;                   // fixed-position: viewport coords

    setSelectionPopup({ x, y, text, loading: true, verse: null });

    try {
      const result = await claudeDetectReferences(anthropicKey, '', buildPassageContext(passageContextRef.current, MAX_CONTEXT_PASSAGES), text);
      const ref = result.references?.[0];
      if (ref && ref.confidence >= 0.5) {
        const apiBibleKey = church?.apibible_key || localStorage.getItem('bible_app_apibible_key') || '';
        const content = await fetchVerseContent(apiBibleKey, selectedTranslation, ref.book, ref.chapter, ref.verseStart, ref.verseEnd);
        setSelectionPopup(prev => prev ? {
          ...prev, loading: false,
          verse: {
            ...ref,
            text: content.text,
            verses: content.verses ?? [],
            reference: formatReference(ref),
            translationName: selectedTranslation.name,
            timestamp: Date.now(),
          },
        } : null);
      } else {
        setSelectionPopup(prev => prev ? { ...prev, loading: false, verse: null } : null);
      }
    } catch {
      setSelectionPopup(null);
    }
  }

  function confirmSelectionVerse(verse) {
    setCurrentVerse(verse);
    setSession(prev => [...prev, verse]);
    passageContextRef.current = [...passageContextRef.current, verse].slice(-MAX_CONTEXT_PASSAGES);
    pushVerseToSupabase(verse);
    setActiveTab('display');
    setSelectionPopup(null);
    window.getSelection()?.removeAllRanges();

    // Generate cross-refs non-blocking
    setIsLoadingXRefs(true);
    setCrossRefs([]);
    const apiBibleKey = church?.apibible_key || localStorage.getItem('bible_app_apibible_key') || '';
    claudeGenerateCrossRefs(anthropicKey, verse.reference, verse.text)
      .then(async xrefData => {
        const enriched = await Promise.allSettled(
          (xrefData.crossReferences ?? []).map(async xref => {
            try {
              const r = await fetchVerseContent(apiBibleKey, selectedTranslation, xref.book, xref.chapter, xref.verseStart, xref.verseEnd);
              return { ...xref, text: r.text };
            } catch { return xref; }
          })
        );
        setCrossRefs(enriched.filter(r => r.status === 'fulfilled').map(r => r.value));
      })
      .catch(() => {})
      .finally(() => setIsLoadingXRefs(false));
  }

  // ── Save API keys (localStorage always; Supabase when available) ──
  async function handleSaveApiKeys(e) {
    e.preventDefault();
    setSettingsSaving(true);
    const anthKey   = settingsAnthKey.trim();
    const bibleKey  = settingsBibleKey.trim();
    // Always persist to localStorage so app works without Supabase schema
    if (anthKey)  localStorage.setItem('bible_app_anthropic_key', anthKey);
    if (bibleKey) localStorage.setItem('bible_app_apibible_key',  bibleKey);
    // Also try to save to Supabase (silently ignore if tables don't exist yet)
    if (church?.id) {
      const updates = {};
      if (anthKey)  updates.anthropic_key = anthKey;
      if (bibleKey) updates.apibible_key  = bibleKey;
      if (Object.keys(updates).length) {
        await supabase.from('churches').update(updates).eq('id', church.id).then(() => {});
      }
    }
    setSettingsSaving(false);
    setSettingsSaved(true);
    setTimeout(() => window.location.reload(), 800);
  }

  const TAB_LABELS    = { display: 'Verse', crossrefs: 'Cross-Refs', history: 'History', transcript: 'Transcript' };
  const DISPLAY_MODES = { projection: 'Projection', sidepanel: 'Side Panel', mobile: 'Mobile' };

  return (
    <div className="min-h-screen flex flex-col overflow-hidden" style={{ background: church?.bg_color || '#0a1520', color: church?.text_color || '#f5ead6' }}
      onMouseUp={handleMouseUp}>

      <SelectionPopup
        popup={selectionPopup}
        onDisplay={confirmSelectionVerse}
        onDismiss={() => { setSelectionPopup(null); window.getSelection()?.removeAllRanges(); }}
        colors={colors}
      />

      <DisambiguationModal
        item={disambigQueue[0] ?? null}
        onAccept={item => { setDisambigQueue(prev => prev.filter(i => i !== item)); loadAndDisplayVerse(item); }}
        onDismiss={() => setDisambigQueue(prev => prev.slice(1))}
      />

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="border-b border-[#1e3050] px-4 py-2 flex items-center gap-3 shrink-0" style={{ background: church?.bg_color ? church.bg_color + 'ee' : '#0d1b2a' }}>
        {church?.logo_url
          ? <img src={church.logo_url} alt={church.name} className="h-7 w-auto" />
          : <span className="text-xl select-none" style={{ color: church?.primary_color || '#d4af37' }}>✝</span>
        }
        <input
          value={sermonTitle}
          onChange={e => handleTitleChange(e.target.value)}
          className="font-serif text-sm bg-transparent border-b border-transparent hover:border-[#2a3a4a] focus:border-[#d4af37] focus:outline-none text-[#c8b89a] w-48 truncate"
          title="Click to rename this sermon"
        />

        <div className="flex items-center gap-2 text-xs font-sans ml-auto">
          {isProcessingNLP && <span className="bg-blue-900/50 text-blue-300 border border-blue-800 px-2 py-0.5 rounded-full animate-pulse">Detecting…</span>}
          {isLoadingVerse  && <span className="bg-amber-900/50 text-amber-300 border border-amber-800 px-2 py-0.5 rounded-full animate-pulse">Loading…</span>}
          <span className={`flex items-center gap-1.5 ${isListening ? 'text-green-400' : 'text-[#4a5a6a]'}`}>
            <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-green-400 animate-pulse' : 'bg-[#3a4a5a]'}`} />
            {isListening ? 'Live' : 'Paused'}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Translation */}
          <select value={selectedTranslation.id} onChange={e => { const t = translations.find(t => t.id === e.target.value); if (t) setSelectedTranslation(t); }}
            className="bg-[#1a2a3a] border border-[#243444] text-[#c8b89a] font-sans text-xs rounded-lg px-2 py-1.5 focus:outline-none hidden sm:block max-w-[110px]">
            {translations.length > FREE_TRANSLATIONS.length ? (
              <>
                <optgroup label="Free">
                  {FREE_TRANSLATIONS.map(t => <option key={t.id} value={t.id}>{t.abbreviation}</option>)}
                </optgroup>
                <optgroup label="API.Bible">
                  {translations.filter(t => t.source === 'apibible').map(t => <option key={t.id} value={t.id}>{t.abbreviation}</option>)}
                </optgroup>
              </>
            ) : FREE_TRANSLATIONS.map(t => <option key={t.id} value={t.id}>{t.abbreviation}</option>)}
          </select>

          {/* Display mode */}
          <div className="bg-[#1a2a3a] rounded-lg p-0.5 border border-[#243444] hidden md:flex">
            {Object.entries(DISPLAY_MODES).map(([mode, label]) => (
              <button key={mode} onClick={() => setDisplayMode(mode)}
                className={`px-2.5 py-1 rounded-md font-sans text-xs transition-colors ${displayMode === mode ? 'text-[#0d1b2a] font-semibold' : 'text-[#6a7a8a] hover:text-[#c8b89a]'}`}
                style={displayMode === mode ? { background: church?.primary_color || '#d4af37' } : {}}>
                {label}
              </button>
            ))}
          </div>

          {/* Congregation link */}
          <button onClick={() => setShowCongLink(p => !p)}
            className={`px-2.5 py-1.5 rounded-lg font-sans text-xs font-medium border transition-colors ${showCongLink ? 'border-[#d4af37]/40 text-[#d4af37] bg-[#d4af37]/10' : 'border-[#243444] text-[#6a7a8a] bg-[#1a2a3a] hover:text-[#c8b89a]'}`}
            title="Congregation & projection links">
            🔗 Share
          </button>

          {/* Listen */}
          <button onClick={isListening ? stopListening : startListening}
            className={`px-3 py-1.5 rounded-lg font-sans text-xs font-semibold border transition-colors ${isListening ? 'bg-red-950 hover:bg-red-900 text-red-300 border-red-800' : 'bg-green-950 hover:bg-green-900 text-green-300 border-green-800'}`}>
            {isListening ? 'Stop' : 'Listen'}
          </button>

          {/* Nav */}
          <Link to="/admin"   className="text-[#3a4a5a] hover:text-[#8a8a8a] font-sans text-xs px-1 transition-colors hidden sm:inline">Admin</Link>
          <Link to="/archive" className="text-[#3a4a5a] hover:text-[#8a8a8a] font-sans text-xs px-1 transition-colors hidden sm:inline">Archive</Link>
          <button
            onClick={() => { setShowSettings(p => !p); setSettingsSaved(false); setSettingsAnthKey(''); setSettingsBibleKey(''); }}
            title="API key settings"
            className={`font-sans text-sm px-1 transition-colors ${showSettings ? 'text-[#d4af37]' : 'text-[#3a4a5a] hover:text-[#8a8a8a]'}`}>
            ⚙
          </button>
          <button onClick={signOut} className="text-[#3a4a5a] hover:text-red-400 font-sans text-xs px-1 transition-colors">Sign out</button>
        </div>
      </header>

      {/* ── Congregation / projection link panel ─────────────── */}
      {showCongLink && (
        <div className="bg-[#0d1b2a] border-b border-[#1e3050] px-4 py-3 shrink-0 space-y-2">
          <div className="flex flex-wrap gap-4 text-sm font-sans">
            <div>
              <p className="text-[#5a6a7a] text-xs uppercase tracking-wider mb-1">Congregation view</p>
              <div className="flex items-center gap-2">
                <span className="text-[#c8b89a] bg-[#1a2a3a] border border-[#243444] px-3 py-1 rounded-lg text-xs">{congUrl}</span>
                <button onClick={() => { navigator.clipboard.writeText(congUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="text-xs text-[#d4af37] hover:underline">{copied ? 'Copied!' : 'Copy'}</button>
              </div>
            </div>
            <div>
              <p className="text-[#5a6a7a] text-xs uppercase tracking-wider mb-1">Projection screen</p>
              <button onClick={openProjectionWindow}
                className="text-xs text-[#d4af37] hover:underline bg-[#1a2a3a] border border-[#243444] px-3 py-1 rounded-lg">
                Open projection window ↗
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── API key settings panel ───────────────────────────── */}
      {showSettings && (
        <div className="bg-[#0d1b2a] border-b border-[#1e3050] px-4 py-3 shrink-0">
          <form onSubmit={handleSaveApiKeys} className="max-w-xl space-y-3">
            <p className="text-[#c8b89a] font-sans text-xs font-semibold uppercase tracking-wider">Update API Keys</p>
            {!anthropicKey && (
              <p className="text-amber-400 font-sans text-xs bg-amber-950/40 border border-amber-900/50 rounded-lg px-3 py-2">
                No Anthropic key found — enter your key below to enable verse detection and cross-references.
              </p>
            )}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[#5a6a7a] font-sans text-xs mb-1">
                  Anthropic key {anthropicKey && <span className="text-green-500">✓ saved</span>}
                </label>
                <input
                  type="password" value={settingsAnthKey} onChange={e => setSettingsAnthKey(e.target.value)}
                  placeholder={anthropicKey ? 'sk-ant-… (leave blank to keep current)' : 'sk-ant-api03-…  (required)'}
                  autoComplete="off"
                  className="w-full bg-[#1a2a3a] border border-[#243444] rounded-lg px-3 py-2 font-sans text-sm text-[#f5ead6] placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37]"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[#5a6a7a] font-sans text-xs mb-1">API.Bible key</label>
                <input
                  type="password" value={settingsBibleKey} onChange={e => setSettingsBibleKey(e.target.value)}
                  placeholder="optional"
                  autoComplete="off"
                  className="w-full bg-[#1a2a3a] border border-[#243444] rounded-lg px-3 py-2 font-sans text-sm text-[#f5ead6] placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37]"
                />
              </div>
              <button
                type="submit"
                disabled={settingsSaving || (!settingsAnthKey.trim() && !settingsBibleKey.trim())}
                className="self-end bg-[#d4af37] hover:bg-[#c4a030] disabled:opacity-40 disabled:cursor-not-allowed text-[#0d1b2a] font-sans font-semibold px-4 py-2 rounded-lg text-sm transition-colors shrink-0"
              >
                {settingsSaving ? 'Saving…' : settingsSaved ? '✓ Saved' : 'Save'}
              </button>
            </div>
            <p className="text-[#3a4a5a] font-sans text-xs">Saving reloads the page to apply the new key.</p>
          </form>
        </div>
      )}

      {/* ── Error banner ──────────────────────────────────────── */}
      {error && (
        <div className="bg-red-950 border-b border-red-900 px-4 py-2 flex items-center justify-between gap-4 shrink-0">
          <p className="text-red-300 font-sans text-sm">{error}</p>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-400 text-lg">×</button>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <main className={`flex flex-col overflow-hidden ${displayMode === 'projection' ? 'w-[240px] xl:w-[270px] shrink-0 border-r border-[#1e3050]' : displayMode === 'sidepanel' ? 'max-w-2xl flex-1 border-r border-[#1e3050]' : 'flex-1'}`}>

          {/* Tab bar */}
          <div className="flex border-b border-[#1e3050] bg-[#0d1b2a] shrink-0">
            {Object.entries(TAB_LABELS).map(([tab, label]) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 font-sans text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 ${activeTab === tab ? 'border-[#d4af37] text-[#d4af37]' : 'border-transparent text-[#4a5a6a] hover:text-[#8a8a8a]'}`}
                style={activeTab === tab ? { borderColor: church?.primary_color || '#d4af37', color: church?.primary_color || '#d4af37' } : {}}>
                {label}
                {tab === 'crossrefs' && crossRefs.length > 0 && <span className="bg-[#d4af37]/20 text-[#d4af37] text-xs rounded-full px-1.5 py-px">{crossRefs.length}</span>}
                {tab === 'history'   && session.length > 0     && <span className="bg-[#1e3050] text-[#6a7a8a] text-xs rounded-full px-1.5 py-px">{session.length}</span>}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col">

            {/* Verse tab */}
            {activeTab === 'display' && (
              <>
                <VerseDisplay verse={currentVerse} mode={displayMode} colors={colors} />
                <div className="pt-4 border-t border-[#1e3050] mt-auto space-y-2">
                  <form onSubmit={handleManualSubmit} className="flex gap-2">
                    <input type="text" value={manualInput} onChange={e => setManualInput(e.target.value)}
                      placeholder="Type a reference — e.g. John 3:16-18 or Romans 8"
                      className="flex-1 bg-[#1a2a3a] border border-[#243444] rounded-lg px-3 py-2 font-sans text-sm text-[#f5ead6] placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37]" />
                    <button type="submit" disabled={isManualLoading || !manualInput.trim()}
                      className="font-sans font-semibold px-4 py-2 rounded-lg text-sm transition-colors text-[#0d1b2a] disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: church?.primary_color || '#d4af37' }}>
                      {isManualLoading ? '…' : 'Go'}
                    </button>
                  </form>
                  {session.length > 0 && (
                    <div className="flex gap-3">
                      <button onClick={() => exportSessionText(session)} className="text-[#4a5a6a] hover:text-[#8a8a8a] font-sans text-xs transition-colors">Export .txt</button>
                      <span className="text-[#2a3a4a]">·</span>
                      <button onClick={clearDisplay} className="text-[#4a5a6a] hover:text-red-400 font-sans text-xs transition-colors">Clear display</button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Cross-refs tab */}
            {activeTab === 'crossrefs' && (
              isLoadingXRefs
                ? <p className="text-center py-10 text-[#4a5a6a] font-sans text-sm animate-pulse">Generating cross-references…</p>
                : <CrossReferencePanel crossRefs={crossRefs} onSelectRef={handleSelectCrossRef} />
            )}

            {/* History tab */}
            {activeTab === 'history' && (
              <>
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <h3 className="text-[#5a6a7a] font-sans text-xs uppercase tracking-wider">Session History</h3>
                  {session.length > 0 && <button onClick={() => exportSessionText(session)} className="text-[#4a5a6a] hover:text-[#d4af37] font-sans text-xs transition-colors">Export .txt</button>}
                </div>
                {session.length === 0
                  ? <p className="text-[#4a5a6a] font-sans text-sm text-center py-10 italic">No passages displayed yet.</p>
                  : (
                    <div className="space-y-2">
                      {[...session].reverse().map((v, i) => (
                        <div key={i} onClick={() => { setCurrentVerse(v); setActiveTab('display'); }}
                          className="bg-[#0d1b2a] border border-[#1e3050] hover:border-[#d4af37]/30 rounded-lg px-4 py-3 cursor-pointer transition-colors">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[#d4af37] font-sans text-sm font-semibold">{v.reference}</span>
                            <span className="text-[#4a5a6a] font-sans text-xs">{new Date(v.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <p className="text-[#7a8a9a] font-serif text-xs line-clamp-1">"{v.text}"</p>
                        </div>
                      ))}
                    </div>
                  )}
              </>
            )}

            {/* Transcript tab */}
            {activeTab === 'transcript' && (
              <>
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <h3 className="text-[#5a6a7a] font-sans text-xs uppercase tracking-wider">Live Transcript</h3>
                  <button onClick={() => { transcriptChunksRef.current = []; setLiveTranscript(''); }}
                    className="text-[#4a5a6a] hover:text-red-400 font-sans text-xs transition-colors">Clear</button>
                </div>
                <div className="bg-[#0d1b2a] border border-[#1e3050] rounded-xl p-4 flex-1 overflow-y-auto min-h-[200px]">
                  {liveTranscript
                    ? <p className="text-[#c8b89a] font-serif text-sm leading-relaxed whitespace-pre-wrap">{liveTranscript}</p>
                    : <p className="text-[#3a4a5a] font-serif text-sm italic">Transcript will appear here while listening…</p>}
                </div>
              </>
            )}
          </div>
        </main>

        {/* Projection preview panel */}
        {displayMode === 'projection' && (
          <div className="flex-1 overflow-hidden">
            <ProjectionPreview
              verse={currentVerse}
              church={church}
              fontSize={projFontSize}
              onFontChange={delta => setProjFontSize(prev => Math.min(5, Math.max(1, prev + delta)))}
              onClear={clearDisplay}
              onOpen={openProjectionWindow}
              isProjecting={isProjecting}
            />
          </div>
        )}

        {/* Side panel cross-refs */}
        {displayMode === 'sidepanel' && (
          <aside className="w-80 bg-[#0d1b2a] flex flex-col overflow-hidden shrink-0">
            <div className="px-4 py-3 border-b border-[#1e3050] shrink-0">
              <h3 className="font-sans text-xs uppercase tracking-widest font-semibold" style={{ color: church?.primary_color || '#d4af37' }}>Cross-References</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {isLoadingXRefs
                ? <p className="text-center py-8 text-[#4a5a6a] font-sans text-sm animate-pulse">Generating…</p>
                : <CrossReferencePanel crossRefs={crossRefs} onSelectRef={handleSelectCrossRef} />}
            </div>
          </aside>
        )}
      </div>

      {/* Mobile bottom nav */}
      {displayMode === 'mobile' && (
        <nav className="bg-[#0d1b2a] border-t border-[#1e3050] flex justify-around py-2 shrink-0">
          {['display','crossrefs','history'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex flex-col items-center gap-0.5 px-4 py-1 rounded-lg font-sans text-xs transition-colors ${activeTab === tab ? '' : 'text-[#4a5a6a]'}`}
              style={activeTab === tab ? { color: church?.primary_color || '#d4af37' } : {}}>
              <span className="text-lg">{tab === 'display' ? '📖' : tab === 'crossrefs' ? '🔗' : '📋'}</span>
              <span>{TAB_LABELS[tab]}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
