/**
 * BibleApp.jsx  —  single-file Bible Display application
 *
 * ═══════════════════════════════════════════════════════════
 * SYSTEM OVERVIEW
 * ═══════════════════════════════════════════════════════════
 * Voice-powered scripture display for live sermons.
 *
 * Data flow:
 *   Microphone → Chrome SpeechRecognition → chunk buffer (50 words / 1.5 s silence)
 *   → Claude Haiku  (detects Bible references, returns JSON)
 *   → fetchVerseContent  (bible-api.com  or  API.Bible)
 *   → VerseDisplay  (operator screen)
 *   → BroadcastChannel → Projection window  (big screen / second monitor)
 *   → Claude Sonnet (generates cross-references) → CrossReferencePanel
 *
 * ═══════════════════════════════════════════════════════════
 * API KEYS  (stored in localStorage — never sent off-device)
 * ═══════════════════════════════════════════════════════════
 *   Anthropic  https://console.anthropic.com       REQUIRED
 *   API.Bible  https://scripture.api.bible          optional
 *
 * ═══════════════════════════════════════════════════════════
 * BIBLE CONTENT SOURCES
 * ═══════════════════════════════════════════════════════════
 *   bible-api.com  — free, no key, KJV / WEB / ASV / BBE / Darby / YLT
 *   API.Bible      — keyed, 80+ translations (NIV, NKJV, ESV, Amplified…)
 *
 * ═══════════════════════════════════════════════════════════
 * HOW TO MAINTAIN
 * ═══════════════════════════════════════════════════════════
 *   Change AI model          → DETECT_MODEL / XREF_MODEL constants
 *   Change free translations → FREE_TRANSLATIONS array
 *                               (IDs must match bible-api.com IDs)
 *   Change silence debounce  → CHUNK_SILENCE_MS (milliseconds)
 *   Change confidence cutoff → CONFIDENCE_THRESHOLD (0.0 – 1.0)
 *   Change colours           → search #0d1b2a (bg) #f5ead6 (text) #d4af37 (gold)
 *   Add a new tab            → add key to TAB_LABELS + branch in "Tab content"
 *   Projection window style  → buildProjectionHTML()
 *
 * ═══════════════════════════════════════════════════════════
 * STARTUP
 * ═══════════════════════════════════════════════════════════
 *   npm install          (first time only)
 *   npm run dev          → http://localhost:3000
 *   1. Enter Anthropic API key on the setup screen.
 *   2. Click "Listen" then speak.
 *   3. Click "⊡ Screen" to open the projection window.
 *   4. Cross-references auto-generate after each verse.
 *
 * ═══════════════════════════════════════════════════════════
 * COMPONENT TREE
 * ═══════════════════════════════════════════════════════════
 *   BibleApp           — root; holds all state and logic
 *   ├─ SetupScreen     — first-run API key entry
 *   ├─ DisambiguationModal — low-confidence reference confirmation
 *   ├─ VerseDisplay    — current verse with per-verse separation
 *   ├─ CrossReferencePanel — Claude-generated cross-refs
 *   └─ SessionHistory  — reverse-chronological passage list
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Constants ───────────────────────────────────────────────────────────────────
// Change models here if Anthropic releases newer versions.

const DETECT_MODEL  = 'claude-haiku-4-5-20251001'; // fast model for live detection
const XREF_MODEL    = 'claude-sonnet-4-6';          // smarter model for cross-references

const ANTHROPIC_API        = 'https://api.anthropic.com/v1/messages';
const APIBIBLE_BASE        = 'https://api.scripture.api.bible/v1';
const FREE_BIBLE_BASE      = 'https://bible-api.com';
const BROADCAST_CHANNEL_NAME = 'bible-projection';  // must match the name in buildProjectionHTML

const CONFIDENCE_THRESHOLD  = 0.7;            // references below this go to disambiguation queue
const TRANSCRIPT_WINDOW_MS  = 10 * 60 * 1000; // how far back the rolling transcript context goes
const MAX_CONTEXT_PASSAGES  = 5;              // how many recent passages Claude gets as context
const CHUNK_WORD_LIMIT      = 50;             // flush buffer early if this many words accumulate
const CHUNK_SILENCE_MS      = 1500;           // flush buffer after this much silence (ms)

const STORAGE_KEY_ANTHROPIC = 'bible_app_anthropic_key';
const STORAGE_KEY_APIBIBLE  = 'bible_app_apibible_key';

// Module-level verse cache — prevents duplicate API calls within a session.
// Key: "translationId:book:chapter:verseStart:verseEnd"
// Value: { text: string, verses: { verseNumber: number, text: string }[] }
const verseCache = new Map();

// Translations available without any API key (bible-api.com IDs).
const FREE_TRANSLATIONS = [
  { id: 'kjv',   name: 'King James Version',         abbreviation: 'KJV',   source: 'free' },
  { id: 'web',   name: 'World English Bible',         abbreviation: 'WEB',   source: 'free' },
  { id: 'asv',   name: 'American Standard Version',   abbreviation: 'ASV',   source: 'free' },
  { id: 'bbe',   name: 'Bible in Basic English',       abbreviation: 'BBE',   source: 'free' },
  { id: 'darby', name: 'Darby Translation',            abbreviation: 'Darby', source: 'free' },
  { id: 'ylt',   name: "Young's Literal Translation",  abbreviation: 'YLT',  source: 'free' },
];

// API.Bible requires book IDs in the format GEN.1.1 (three-letter codes).
const BOOK_IDS = {
  'Genesis':'GEN','Exodus':'EXO','Leviticus':'LEV','Numbers':'NUM',
  'Deuteronomy':'DEU','Joshua':'JOS','Judges':'JDG','Ruth':'RUT',
  '1 Samuel':'1SA','2 Samuel':'2SA','1 Kings':'1KI','2 Kings':'2KI',
  '1 Chronicles':'1CH','2 Chronicles':'2CH','Ezra':'EZR','Nehemiah':'NEH',
  'Esther':'EST','Job':'JOB','Psalms':'PSA','Psalm':'PSA','Proverbs':'PRO',
  'Ecclesiastes':'ECC','Song of Solomon':'SNG','Song of Songs':'SNG',
  'Isaiah':'ISA','Jeremiah':'JER','Lamentations':'LAM','Ezekiel':'EZK',
  'Daniel':'DAN','Hosea':'HOS','Joel':'JOL','Amos':'AMO','Obadiah':'OBA',
  'Jonah':'JON','Micah':'MIC','Nahum':'NAM','Habakkuk':'HAB','Zephaniah':'ZEP',
  'Haggai':'HAG','Zechariah':'ZEC','Malachi':'MAL',
  'Matthew':'MAT','Mark':'MRK','Luke':'LUK','John':'JHN','Acts':'ACT',
  'Romans':'ROM','1 Corinthians':'1CO','2 Corinthians':'2CO','Galatians':'GAL',
  'Ephesians':'EPH','Philippians':'PHP','Colossians':'COL',
  '1 Thessalonians':'1TH','2 Thessalonians':'2TH','1 Timothy':'1TI',
  '2 Timothy':'2TI','Titus':'TIT','Philemon':'PHM','Hebrews':'HEB',
  'James':'JAS','1 Peter':'1PE','2 Peter':'2PE','1 John':'1JN',
  '2 John':'2JN','3 John':'3JN','Jude':'JUD','Revelation':'REV',
};

// Tag colours for cross-reference badges — add new tags here if needed.
const XREF_TAG_COLORS = {
  'Prophecy/Fulfillment': 'bg-purple-900 text-purple-200 border-purple-700',
  'Thematic Echo':        'bg-blue-900   text-blue-200   border-blue-700',
  'Same Author':          'bg-emerald-900 text-emerald-200 border-emerald-700',
  'Doctrinal Parallel':   'bg-amber-900  text-amber-200  border-amber-700',
  'Narrative Parallel':   'bg-rose-900   text-rose-200   border-rose-700',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────────

/** Build a human-readable reference string, e.g. "John 3:16–18". */
function formatReference(ref) {
  if (!ref) return '';
  const { book, chapter, verseStart, verseEnd } = ref;
  if (!verseEnd || verseStart === verseEnd) return `${book} ${chapter}:${verseStart}`;
  return `${book} ${chapter}:${verseStart}–${verseEnd}`;
}

/** Strip HTML tags from API.Bible text-type responses. */
function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').trim();
}

/** Return transcript text from the last TRANSCRIPT_WINDOW_MS milliseconds. */
function buildTranscriptContext(chunks) {
  const cutoff = Date.now() - TRANSCRIPT_WINDOW_MS;
  return chunks.filter(c => c.timestamp > cutoff).map(c => c.text).join(' ');
}

/** Format the most recent passages as context lines for Claude. */
function buildPassageContext(passages) {
  return passages
    .slice(-MAX_CONTEXT_PASSAGES)
    .map(p => `${formatReference(p)}: "${p.text.slice(0, 120)}"`)
    .join('\n');
}

/** Download session history as a plain-text file. */
function exportSession(session) {
  const lines = ['BIBLE DISPLAY — SESSION EXPORT', '='.repeat(50), ''];
  session.forEach(entry => {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    lines.push(`[${time}] ${entry.reference} (${entry.translationName})`);
    lines.push(entry.text);
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `sermon-${new Date().toISOString().split('T')[0]}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Projection window HTML ───────────────────────────────────────────────────────
// Self-contained HTML injected via document.write into the projection popup.
// It listens on BroadcastChannel 'bible-projection' for:
//   { type: 'VERSE_UPDATE', payload: { text, reference, translationName, verses } }
//   { type: 'CLEAR' }
//   { type: 'THEME_UPDATE', payload: { bg, fg, accent } }

function buildProjectionHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bible Projection</title>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1b2a;
      color: #f5ead6;
      font-family: 'EB Garamond', Georgia, serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    #content {
      text-align: center;
      padding: 4rem;
      max-width: 90vw;
      opacity: 0;
      transition: opacity 0.6s ease, transform 0.6s ease;
      transform: translateY(12px);
    }
    #content.visible { opacity: 1; transform: translateY(0); }

    /* Single-verse display */
    #verse-text { font-size: clamp(1.6rem, 4.5vw, 5rem); line-height: 1.5; margin-bottom: 2rem; }

    /* Multi-verse: each verse on its own line with a superscript number */
    .vblock { display: block; padding: 0.3em 0; }
    .vnum   { font-size: 0.45em; vertical-align: super; color: #8a9aaa; font-family: sans-serif;
               font-weight: 600; margin-right: 0.35em; }

    #reference       { font-size: clamp(1rem, 2.2vw, 2.2rem); color: #d4af37; font-weight: 600; letter-spacing: .06em; }
    #translation-name { font-size: clamp(.7rem, 1.1vw, 1.1rem); color: #6a7a8a; margin-top: .6rem;
                         text-transform: uppercase; letter-spacing: .12em; font-family: sans-serif; }
    #watermark { position: fixed; bottom: 1.2rem; right: 1.8rem; font-size: .65rem;
                  color: #1e2e3e; letter-spacing: .1em; font-family: sans-serif; text-transform: uppercase; }
  </style>
</head>
<body>
  <div id="content">
    <div id="verse-text"></div>
    <p id="reference"></p>
    <p id="translation-name"></p>
  </div>
  <div id="watermark">Bible Display</div>
  <script>
    var c   = document.getElementById('content');
    var vEl = document.getElementById('verse-text');
    var rEl = document.getElementById('reference');
    var tEl = document.getElementById('translation-name');

    function show(p) {
      c.classList.remove('visible');
      setTimeout(function () {
        if (p.verses && p.verses.length > 1) {
          // Multi-verse range: render each verse on its own line with a superscript number
          vEl.innerHTML = p.verses.map(function (v) {
            return '<span class="vblock"><sup class="vnum">' + v.verseNumber + '</sup> ' +
                   v.text.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
          }).join('');
        } else {
          vEl.textContent = p.text || '';
        }
        rEl.textContent = p.reference || '';
        tEl.textContent = p.translationName || '';
        c.classList.add('visible');
      }, 320);
    }

    function clear() {
      c.classList.remove('visible');
      setTimeout(function () {
        vEl.innerHTML = '';
        rEl.textContent = '';
        tEl.textContent = '';
      }, 320);
    }

    var ch = new BroadcastChannel('bible-projection');
    ch.onmessage = function (e) {
      if      (e.data.type === 'VERSE_UPDATE') show(e.data.payload);
      else if (e.data.type === 'CLEAR')        clear();
      else if (e.data.type === 'THEME_UPDATE') {
        document.body.style.background = e.data.payload.bg     || '#0d1b2a';
        document.body.style.color      = e.data.payload.fg     || '#f5ead6';
        rEl.style.color                = e.data.payload.accent || '#d4af37';
      }
    };
    window.addEventListener('beforeunload', function () { ch.close(); });
  <\/script>
</body>
</html>`;
}

// ─── Claude API calls ─────────────────────────────────────────────────────────────

/**
 * Ask Claude Haiku to find Bible references in a spoken chunk.
 *
 * Returns: { references: [ { raw, book, chapter, verseStart, verseEnd, confidence, isPartial } ] }
 *
 * Confidence rules:
 *   >= CONFIDENCE_THRESHOLD → load verse immediately
 *   0.5 – 0.69             → send to disambiguation queue
 *   < 0.5                  → discard
 */
async function claudeDetectReferences(anthropicKey, transcriptContext, passageContext, chunk) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true', // required for browser → Anthropic direct calls
    },
    body: JSON.stringify({
      model: DETECT_MODEL,
      max_tokens: 256,
      system: `You are a Bible reference detector for live sermon transcription. Find Bible references—explicit ("John 3:16") or implicit ("God so loved the world")—in spoken chunks. Use rolling context to resolve partial references. Return valid JSON only, no markdown.`,
      messages: [{
        role: 'user',
        content: `Rolling transcript (last 10 min):\n${transcriptContext || '(none)'}\n\nRecently displayed:\n${passageContext || '(none)'}\n\nNew chunk:\n"${chunk}"\n\nReturn JSON:\n{"references":[{"raw":"words spoken","book":"Genesis","chapter":1,"verseStart":1,"verseEnd":3,"confidence":0.95,"isPartial":false}]}\n\nRules: confidence 0.0–1.0, include only >= 0.5, isPartial=true if inferred from context, return {"references":[]} if nothing found. JSON only.`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data  = await res.json();
  const text  = data.content?.[0]?.text?.trim() ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude returned no JSON');
  return JSON.parse(match[0]);
}

/**
 * Ask Claude Sonnet to generate 3–5 cross-references for a displayed passage.
 *
 * Returns: { crossReferences: [ { reference, book, chapter, verseStart, verseEnd, tag, reason } ] }
 * tag must be one of the keys in XREF_TAG_COLORS.
 */
async function claudeGenerateCrossRefs(anthropicKey, reference, verseText) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: XREF_MODEL,
      max_tokens: 1024,
      system: `You are a Bible scholar generating cross-references for live sermon display. Return valid JSON only, no markdown.`,
      messages: [{
        role: 'user',
        content: `Passage: ${reference}\nText: "${verseText}"\n\nGenerate 3–5 cross-references. Return JSON:\n{"crossReferences":[{"reference":"Romans 8:28","book":"Romans","chapter":8,"verseStart":28,"verseEnd":28,"tag":"Doctrinal Parallel","reason":"One sentence."}]}\n\ntag must be one of: "Prophecy/Fulfillment","Thematic Echo","Same Author","Doctrinal Parallel","Narrative Parallel". JSON only.`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data  = await res.json();
  const text  = data.content?.[0]?.text?.trim() ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude returned no JSON');
  return JSON.parse(match[0]);
}

// ─── Bible content fetching ───────────────────────────────────────────────────────
// All fetch functions return { text: string, verses: { verseNumber, text }[] }.
// - text    — full combined text (used for Claude context, export, cross-refs)
// - verses  — one entry per verse number (used for separated display)

/**
 * Fetch from bible-api.com (free, no key required).
 * The API always returns data.verses[], so individual verse texts are available.
 */
async function fetchFromFreeApi(translationId, book, chapter, verseStart, verseEnd) {
  const ve       = verseEnd ?? verseStart;
  const range    = ve !== verseStart ? `${verseStart}-${ve}` : `${verseStart}`;
  const bookPath = book.toLowerCase().replace(/\s+/g, '+');
  const url      = `${FREE_BIBLE_BASE}/${bookPath}+${chapter}:${range}?translation=${translationId}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`bible-api.com ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  // data.verses is always an array — one element per verse number
  const verses = (data.verses ?? [])
    .map(v => ({ verseNumber: v.verse, text: v.text.trim().replace(/\n+/g, ' ') }))
    .filter(v => v.text);

  const text = verses.length
    ? verses.map(v => v.text).join(' ')
    : (data.text ?? '').trim().replace(/\n+/g, ' ');

  if (!text) throw new Error('Empty response from bible-api.com');
  return { text, verses };
}

/**
 * Fetch from API.Bible (requires API key, supports 80+ translations).
 * We request include-verse-numbers=true so the response embeds [n] markers,
 * then parse those markers to build the verses array.
 */
async function fetchFromApiBible(apiKey, bibleId, book, chapter, verseStart, verseEnd) {
  const bookId = BOOK_IDS[book];
  if (!bookId) throw new Error(`Unknown book: ${book}`);

  const ve        = verseEnd ?? verseStart;
  const startId   = `${bookId}.${chapter}.${verseStart}`;
  const endId     = `${bookId}.${chapter}.${ve}`;
  const passageId = startId === endId ? startId : `${startId}-${endId}`;

  // include-verse-numbers=true embeds [16] markers so we can split by verse
  const params = [
    'content-type=text',
    'include-notes=false',
    'include-titles=false',
    'include-chapter-numbers=false',
    'include-verse-numbers=true',
    'include-verse-spans=false',
  ].join('&');

  const res = await fetch(
    `${APIBIBLE_BASE}/bibles/${bibleId}/passages/${passageId}?${params}`,
    { headers: { 'api-key': apiKey } }
  );
  if (!res.ok) throw new Error(`API.Bible ${res.status}`);
  const data = await res.json();
  const raw  = stripHtml(data.data?.content ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) throw new Error('Empty passage from API.Bible');

  // Parse "[16] text [17] text" into individual verse objects
  const verses = [];
  const versePattern = /\[(\d+)\]\s*([^[]+)/g;
  let m;
  while ((m = versePattern.exec(raw)) !== null) {
    const t = m[2].trim();
    if (t) verses.push({ verseNumber: parseInt(m[1], 10), text: t });
  }

  const text = verses.length ? verses.map(v => v.text).join(' ') : raw;
  return { text, verses };
}

/**
 * Load the list of available translations.
 * Free translations are always returned; API.Bible translations are appended
 * only when a valid key is present.
 */
async function loadTranslationList(apiBibleKey) {
  if (!apiBibleKey) return FREE_TRANSLATIONS;
  try {
    const res = await fetch(`${APIBIBLE_BASE}/bibles`, {
      headers: { 'api-key': apiBibleKey },
    });
    if (!res.ok) return FREE_TRANSLATIONS;
    const data    = await res.json();
    const english = (data.data ?? [])
      .filter(b => b.language?.id === 'eng' && b.type === 'text')
      .slice(0, 80)
      .map(b => ({
        id:           b.id,
        name:         b.name,
        abbreviation: b.abbreviationLocal || b.abbreviation || b.name.slice(0, 8),
        source:       'apibible',
      }));
    return [...FREE_TRANSLATIONS, ...english];
  } catch {
    return FREE_TRANSLATIONS;
  }
}

/**
 * Main verse fetch — checks the module-level cache first.
 * Tries API.Bible when the selected translation came from there;
 * falls back to bible-api.com (KJV) on any failure.
 *
 * Returns { text: string, verses: { verseNumber, text }[] }
 */
async function fetchVerseContent(apiBibleKey, translation, book, chapter, verseStart, verseEnd) {
  const ve       = verseEnd ?? verseStart;
  const cacheKey = `${translation.id}:${book}:${chapter}:${verseStart}:${ve}`;

  if (verseCache.has(cacheKey)) return verseCache.get(cacheKey);

  let result;

  if (translation.source === 'apibible' && apiBibleKey) {
    try {
      result = await fetchFromApiBible(apiBibleKey, translation.id, book, chapter, verseStart, ve);
    } catch (err) {
      console.warn('API.Bible failed, falling back to free API:', err.message);
    }
  }

  if (!result) {
    const freeId = translation.source === 'free' ? translation.id : 'kjv';
    result = await fetchFromFreeApi(freeId, book, chapter, verseStart, ve);
  }

  verseCache.set(cacheKey, result);
  return result;
}

// ─── SetupScreen ─────────────────────────────────────────────────────────────────
// Shown only on first run (or after "Reset all keys").
// Validates the Anthropic key with a cheap API call before saving.

function SetupScreen({ onComplete }) {
  const [anthropicKey, setAnthropicKey] = useState('');
  const [apiBibleKey,  setApiBibleKey]  = useState('');
  const [error,        setError]        = useState('');
  const [loading,      setLoading]      = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const ak = anthropicKey.trim();
    const bk = apiBibleKey.trim();
    if (!ak) { setError('Anthropic API key is required.'); return; }
    setLoading(true);
    setError('');

    // Smoke-test the Anthropic key with a minimal request
    try {
      const res = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ak,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: DETECT_MODEL,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      if (res.status === 401) {
        setError('Anthropic key is invalid. Please check and try again.');
        setLoading(false);
        return;
      }
    } catch {
      setError('Network error — check your internet connection.');
      setLoading(false);
      return;
    }

    localStorage.setItem(STORAGE_KEY_ANTHROPIC, ak);
    if (bk) localStorage.setItem(STORAGE_KEY_APIBIBLE, bk);
    else     localStorage.removeItem(STORAGE_KEY_APIBIBLE);

    setLoading(false);
    onComplete({ anthropic: ak, apibible: bk });
  }

  return (
    <div className="min-h-screen bg-[#0d1b2a] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="text-5xl mb-4 select-none">✝</div>
          <h1 className="text-3xl font-serif text-[#f5ead6] mb-2">Bible Display</h1>
          <p className="text-[#6a7a8a] text-sm font-sans">Voice-powered sermon scripture display</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#1a2a3a] rounded-2xl p-8 shadow-2xl border border-[#243444]">
          <h2 className="text-[#d4af37] font-sans font-semibold text-base mb-6">Setup</h2>

          <div className="mb-5">
            <label className="block text-[#c8b89a] font-sans text-sm mb-1.5">
              Anthropic API Key <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              value={anthropicKey}
              onChange={e => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
              className="w-full bg-[#0d1b2a] border border-[#243444] rounded-lg px-4 py-3 text-[#f5ead6] font-sans text-sm placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37] transition-colors"
            />
            <p className="text-[#4a5a6a] font-sans text-xs mt-1">
              Required — used for reference detection and cross-references.
            </p>
          </div>

          <div className="mb-6">
            <label className="block text-[#c8b89a] font-sans text-sm mb-1.5">
              API.Bible Key{' '}
              <span className="text-[#4a5a6a] font-normal">(optional)</span>
            </label>
            <input
              type="password"
              value={apiBibleKey}
              onChange={e => setApiBibleKey(e.target.value)}
              placeholder="Your API.Bible key"
              autoComplete="off"
              className="w-full bg-[#0d1b2a] border border-[#243444] rounded-lg px-4 py-3 text-[#f5ead6] font-sans text-sm placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37] transition-colors"
            />
            <p className="text-[#4a5a6a] font-sans text-xs mt-1">
              Optional — unlocks NIV, NKJV, ESV and 80+ more translations.
            </p>
          </div>

          {error && (
            <div className="mb-4 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-red-300 font-sans text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#d4af37] hover:bg-[#c4a030] disabled:bg-[#5a4a1a] disabled:cursor-not-allowed text-[#0d1b2a] font-sans font-semibold py-3 rounded-lg transition-colors text-sm"
          >
            {loading ? 'Verifying…' : 'Get Started'}
          </button>

          <p className="text-[#4a5a6a] font-sans text-xs text-center mt-4">
            Keys are stored locally in your browser only.
          </p>
        </form>
      </div>
    </div>
  );
}

// ─── DisambiguationModal ──────────────────────────────────────────────────────────
// Shown when Claude detects a reference with confidence 0.5–0.69.
// The operator confirms ("Yes, show it") or skips.

function DisambiguationModal({ item, onAccept, onDismiss }) {
  if (!item) return null;
  return (
    <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a2a3a] border border-[#d4af37]/25 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <p className="text-[#d4af37] font-sans font-semibold text-xs uppercase tracking-widest mb-1">Did you mean?</p>
        <p className="text-[#f5ead6] text-xl font-serif mb-1">{formatReference(item)}</p>
        <p className="text-[#8a8a8a] font-sans text-sm mb-3">
          Detected from: <span className="text-[#c8b89a] italic">"{item.raw}"</span>
        </p>
        <p className="text-[#5a6a7a] font-sans text-xs mb-5">
          Confidence: {Math.round(item.confidence * 100)}% — inferred from context.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => onAccept(item)}
            className="flex-1 bg-[#d4af37] hover:bg-[#c4a030] text-[#0d1b2a] font-sans font-semibold py-2 rounded-lg text-sm transition-colors"
          >
            Yes, show it
          </button>
          <button
            onClick={onDismiss}
            className="flex-1 bg-[#0d1b2a] hover:bg-[#162230] text-[#8a8a8a] border border-[#243444] py-2 rounded-lg font-sans text-sm transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CrossReferencePanel ──────────────────────────────────────────────────────────
// Renders the list of cross-references generated by Claude Sonnet.
// Each card shows the reference, a tag badge, a preview of the verse text,
// and a one-sentence reason. Clicking a card loads that verse.

function CrossReferencePanel({ crossRefs, onSelectRef }) {
  if (crossRefs.length === 0) {
    return (
      <p className="text-[#4a5a6a] font-sans text-sm text-center py-10 italic">
        Cross-references appear here after a verse is displayed.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {crossRefs.map((ref, i) => (
        <div
          key={i}
          onClick={() => onSelectRef(ref)}
          className="bg-[#0d1b2a] border border-[#1e3050] hover:border-[#d4af37]/40 rounded-xl p-4 cursor-pointer transition-colors group"
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <span className="text-[#d4af37] font-sans font-semibold text-sm group-hover:underline">
              {ref.reference}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-sans shrink-0 ${XREF_TAG_COLORS[ref.tag] ?? 'bg-gray-900 text-gray-300 border-gray-700'}`}>
              {ref.tag}
            </span>
          </div>
          {ref.text && (
            <p className="text-[#c8b89a] font-serif text-sm mb-2 line-clamp-2">"{ref.text}"</p>
          )}
          <p className="text-[#5a6a7a] font-sans text-xs">{ref.reason}</p>
        </div>
      ))}
    </div>
  );
}

// ─── VerseDisplay ─────────────────────────────────────────────────────────────────
// Renders the current verse.
// Single verse → quoted block.
// Multi-verse range → each verse on its own line with a superscript number,
//   matching the separated style used in the projection window.

function VerseDisplay({ verse, mode }) {
  const size =
    mode === 'projection' ? 'text-3xl md:text-4xl lg:text-5xl' :
    mode === 'sidepanel'  ? 'text-2xl md:text-3xl' :
                            'text-xl';

  if (!verse) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[200px]">
        <p className="text-[#2a3a4a] font-serif text-lg italic text-center px-4">
          Listening for scripture references…
        </p>
      </div>
    );
  }

  const isMultiVerse = verse.verses && verse.verses.length > 1;

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-8 px-4 animate-fade-in">
      {isMultiVerse ? (
        // Multi-verse: render each verse separated with its verse number as superscript
        <div className={`font-serif text-[#f5ead6] leading-relaxed mb-6 w-full max-w-3xl text-center space-y-3 ${size}`}>
          {verse.verses.map(v => (
            <p key={v.verseNumber}>
              <sup
                className="text-[#8a9aaa] font-sans"
                style={{ fontSize: '0.45em', verticalAlign: 'super', marginRight: '0.35em' }}
              >
                {v.verseNumber}
              </sup>
              {v.text}
            </p>
          ))}
        </div>
      ) : (
        // Single verse: traditional quoted block
        <blockquote className={`font-serif text-[#f5ead6] leading-relaxed mb-6 text-center ${size}`}>
          "{verse.text}"
        </blockquote>
      )}
      <p className="text-[#d4af37] font-sans font-semibold text-lg tracking-wide">
        {verse.reference}
      </p>
      <p className="text-[#5a6a7a] font-sans text-xs mt-1 uppercase tracking-widest">
        {verse.translationName}
      </p>
    </div>
  );
}

// ─── SessionHistory ───────────────────────────────────────────────────────────────
// Reverse-chronological list of every verse displayed this session.
// Clicking an entry restores it to the display (and broadcasts to projection).

function SessionHistory({ session, onSelectEntry }) {
  if (session.length === 0) {
    return (
      <p className="text-[#4a5a6a] font-sans text-sm text-center py-10 italic">
        No passages displayed yet this session.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {[...session].reverse().map((entry, i) => (
        <div
          key={i}
          onClick={() => onSelectEntry(entry)}
          className="bg-[#0d1b2a] border border-[#1e3050] hover:border-[#d4af37]/30 rounded-lg px-4 py-3 cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[#d4af37] font-sans text-sm font-semibold">{entry.reference}</span>
            <span className="text-[#4a5a6a] font-sans text-xs">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-[#7a8a9a] font-serif text-xs line-clamp-1">"{entry.text}"</p>
        </div>
      ))}
    </div>
  );
}

// ─── BibleApp (root component) ────────────────────────────────────────────────────
// All state, refs, event handlers, and top-level layout live here.
// Sub-components are purely presentational — they receive props and call callbacks.

export default function BibleApp() {

  // ── Persistent state (survives page refresh via localStorage) ─────────────────
  const [isSetup, setIsSetup] = useState(() => !!localStorage.getItem(STORAGE_KEY_ANTHROPIC));
  const [apiKeys, setApiKeys] = useState(() => ({
    anthropic: localStorage.getItem(STORAGE_KEY_ANTHROPIC) ?? '',
    apibible:  localStorage.getItem(STORAGE_KEY_APIBIBLE)  ?? '',
  }));

  // ── Voice recognition ─────────────────────────────────────────────────────────
  const [isListening,    setIsListening]    = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');

  // ── Verse state ───────────────────────────────────────────────────────────────
  // currentVerse shape:
  //   { book, chapter, verseStart, verseEnd, text, verses, reference, translationName, timestamp }
  const [currentVerse,   setCurrentVerse]   = useState(null);
  const [isLoadingVerse, setIsLoadingVerse] = useState(false);

  // ── Disambiguation queue ──────────────────────────────────────────────────────
  // References with 0.5–0.69 confidence wait here; modal shows the first one.
  const [disambigQueue, setDisambigQueue] = useState([]);

  // ── Cross-references ──────────────────────────────────────────────────────────
  const [crossRefs,      setCrossRefs]      = useState([]);
  const [isLoadingXRefs, setIsLoadingXRefs] = useState(false);

  // ── Translations ──────────────────────────────────────────────────────────────
  const [translations,        setTranslations]        = useState(FREE_TRANSLATIONS);
  const [selectedTranslation, setSelectedTranslation] = useState(FREE_TRANSLATIONS[0]);

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [displayMode,     setDisplayMode]     = useState('projection'); // projection | sidepanel | mobile
  const [activeTab,       setActiveTab]       = useState('display');    // display | crossrefs | history | transcript
  const [manualInput,     setManualInput]     = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [isProjectionOpen, setIsProjectionOpen] = useState(false);
  const [isProcessingNLP,  setIsProcessingNLP]  = useState(false);
  const [error,            setError]            = useState(null);
  const [session,          setSession]          = useState([]);

  // ── API.Bible inline key panel ────────────────────────────────────────────────
  const [showKeyPanel,    setShowKeyPanel]    = useState(false);
  const [keyPanelInput,   setKeyPanelInput]   = useState('');
  const [keyPanelStatus,  setKeyPanelStatus]  = useState(null); // null | 'loading' | 'ok' | 'error'

  // ── Refs (values that must not trigger re-renders) ────────────────────────────
  const recognitionRef      = useRef(null);   // SpeechRecognition instance
  const broadcastRef        = useRef(null);   // BroadcastChannel instance
  const projectionWindowRef = useRef(null);   // reference to the popup window
  const transcriptChunksRef = useRef([]);     // rolling transcript for Claude context
  const passageContextRef   = useRef([]);     // recently displayed passages for Claude context
  const processingLockRef   = useRef(false);  // prevents overlapping verse loads
  const chunkBufferRef      = useRef('');     // accumulates words until flush threshold
  const chunkTimerRef       = useRef(null);   // silence-debounce timer

  // ── Setup complete callback ───────────────────────────────────────────────────
  function handleSetupComplete(keys) {
    setApiKeys(keys);
    setIsSetup(true);
  }

  // ── Load translations once setup is complete ──────────────────────────────────
  useEffect(() => {
    if (!isSetup) return;
    loadTranslationList(apiKeys.apibible).then(setTranslations);
  }, [isSetup, apiKeys.apibible]);

  // ── Open / close BroadcastChannel ────────────────────────────────────────────
  useEffect(() => {
    if (!isSetup) return;
    const ch = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastRef.current = ch;
    return () => ch.close();
  }, [isSetup]);

  // ── Send a verse to the projection window ─────────────────────────────────────
  const broadcastVerse = useCallback((verse) => {
    broadcastRef.current?.postMessage({
      type: 'VERSE_UPDATE',
      payload: {
        text:            verse.text,
        reference:       verse.reference,
        translationName: verse.translationName,
        verses:          verse.verses ?? [], // needed for multi-verse display in projection
      },
    });
  }, []);

  // ── Fetch a verse and update all state ───────────────────────────────────────
  // processingLockRef prevents two simultaneous fetches (e.g. overlapping voice chunks).
  const loadAndDisplayVerse = useCallback(async (ref) => {
    if (processingLockRef.current) return;
    processingLockRef.current = true;
    setIsLoadingVerse(true);
    setError(null);
    try {
      const result = await fetchVerseContent(
        apiKeys.apibible,
        selectedTranslation,
        ref.book, ref.chapter, ref.verseStart, ref.verseEnd
      );
      const reference = formatReference(ref);
      const verse = {
        book:      ref.book,
        chapter:   ref.chapter,
        verseStart: ref.verseStart,
        verseEnd:   ref.verseEnd ?? ref.verseStart,
        text:       result.text,
        verses:     result.verses, // structured for per-verse display
        reference,
        translationName: selectedTranslation.name,
        timestamp:  Date.now(),
      };
      setCurrentVerse(verse);
      broadcastVerse(verse);
      setSession(prev => [...prev, verse]);
      passageContextRef.current = [...passageContextRef.current, verse].slice(-MAX_CONTEXT_PASSAGES);

      // Cross-references are generated asynchronously — they don't block the verse display.
      setIsLoadingXRefs(true);
      setCrossRefs([]);
      claudeGenerateCrossRefs(apiKeys.anthropic, reference, result.text)
        .then(async xrefData => {
          const refs     = xrefData.crossReferences ?? [];
          const enriched = await Promise.allSettled(
            refs.map(async xref => {
              try {
                // Pre-fetch the cross-ref verse text for the preview card
                const xrefResult = await fetchVerseContent(
                  apiKeys.apibible, selectedTranslation,
                  xref.book, xref.chapter, xref.verseStart, xref.verseEnd
                );
                return { ...xref, text: xrefResult.text };
              } catch {
                return xref; // show the card without a preview if fetch fails
              }
            })
          );
          setCrossRefs(enriched.filter(r => r.status === 'fulfilled').map(r => r.value));
        })
        .catch(err => console.warn('Cross-ref generation failed:', err.message))
        .finally(() => setIsLoadingXRefs(false));

    } catch (err) {
      setError(`Could not load verse: ${err.message}`);
    } finally {
      setIsLoadingVerse(false);
      processingLockRef.current = false;
    }
  }, [apiKeys, selectedTranslation, broadcastVerse]);

  // ── NLP: send a buffered chunk to Claude for reference detection ──────────────
  const processChunk = useCallback(async (chunk) => {
    if (!chunk.trim() || !apiKeys.anthropic) return;
    setIsProcessingNLP(true);
    try {
      const result = await claudeDetectReferences(
        apiKeys.anthropic,
        buildTranscriptContext(transcriptChunksRef.current),
        buildPassageContext(passageContextRef.current),
        chunk
      );
      for (const ref of result.references ?? []) {
        if (ref.confidence >= CONFIDENCE_THRESHOLD) {
          await loadAndDisplayVerse(ref);
          break; // only load the first high-confidence reference per chunk
        } else if (ref.confidence >= 0.5) {
          setDisambigQueue(prev => [...prev, ref]);
        }
      }
    } catch (err) {
      console.warn('NLP detection error:', err.message);
    } finally {
      setIsProcessingNLP(false);
    }
  }, [apiKeys.anthropic, loadAndDisplayVerse]);

  // Drain the chunk buffer, add to rolling transcript, and send to Claude.
  const flushChunkBuffer = useCallback(() => {
    const chunk = chunkBufferRef.current.trim();
    if (!chunk) return;
    chunkBufferRef.current = '';
    const now = Date.now();
    transcriptChunksRef.current.push({ text: chunk, timestamp: now });
    // Drop chunks older than the transcript window
    transcriptChunksRef.current = transcriptChunksRef.current.filter(
      c => c.timestamp > now - TRANSCRIPT_WINDOW_MS
    );
    processChunk(chunk);
  }, [processChunk]);

  // ── Speech recognition ────────────────────────────────────────────────────────
  // Uses the Chrome / Edge webkitSpeechRecognition API (not available in Firefox).
  // Runs in continuous mode and auto-restarts on end so it never goes silent.

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) { setError('Speech recognition requires Chrome or Edge.'); return; }

    const recognition         = new SR();
    recognition.continuous    = true;
    recognition.interimResults = true;
    recognition.lang          = 'en-US';
    recognitionRef.current    = recognition;

    recognition.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const spoken = event.results[i][0].transcript;
          chunkBufferRef.current += ' ' + spoken;
          setLiveTranscript(prev => prev + ' ' + spoken);
          // Reset silence timer on every new word
          clearTimeout(chunkTimerRef.current);
          chunkTimerRef.current = setTimeout(flushChunkBuffer, CHUNK_SILENCE_MS);
          // Also flush early if the buffer hits the word limit
          if (chunkBufferRef.current.trim().split(/\s+/).length >= CHUNK_WORD_LIMIT) {
            flushChunkBuffer();
          }
        }
      }
    };

    recognition.onerror = e => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setError(`Mic error: ${e.error}`);
      }
    };

    // Auto-restart keeps the session alive after browser pauses recognition
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        try { recognition.start(); } catch {}
      }
    };

    recognition.start();
    setIsListening(true);
  }, [flushChunkBuffer]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null; // prevent auto-restart
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    clearTimeout(chunkTimerRef.current);
    flushChunkBuffer(); // flush any remaining buffer
    setIsListening(false);
  }, [flushChunkBuffer]);

  // ── Projection window ─────────────────────────────────────────────────────────
  // Opens a popup and injects self-contained HTML via document.write.
  // Communication is via BroadcastChannel — no URL / iframe required.

  function openProjectionWindow() {
    const win = window.open(
      '', 'bible-projection-screen',
      'width=1920,height=1080,menubar=no,toolbar=no,location=no,status=no,scrollbars=no'
    );
    if (!win) {
      setError('Pop-up blocked. Allow pop-ups for this page, then try again.');
      return;
    }
    win.document.open();
    win.document.write(buildProjectionHTML());
    win.document.close();
    projectionWindowRef.current = win;
    setIsProjectionOpen(true);
    // Send the current verse to the fresh window after it has time to initialise
    if (currentVerse) setTimeout(() => broadcastVerse(currentVerse), 600);
    win.addEventListener('beforeunload', () => {
      projectionWindowRef.current = null;
      setIsProjectionOpen(false);
    });
  }

  function closeProjectionWindow() {
    if (projectionWindowRef.current && !projectionWindowRef.current.closed) {
      projectionWindowRef.current.close();
    }
    projectionWindowRef.current = null;
    setIsProjectionOpen(false);
  }

  // ── Manual verse lookup ───────────────────────────────────────────────────────
  // Parses typed text through Claude so partial references ("third chapter of John")
  // work the same as voice-detected ones.

  async function handleManualSubmit(e) {
    e.preventDefault();
    const input = manualInput.trim();
    if (!input || isManualLoading) return;
    setIsManualLoading(true);
    setError(null);
    try {
      const result = await claudeDetectReferences(apiKeys.anthropic, '', '', input);
      const refs   = result.references ?? [];
      if (refs.length === 0) {
        setError(`Could not parse "${input}" as a Bible reference.`);
      } else {
        await loadAndDisplayVerse(refs[0]);
        setManualInput('');
      }
    } catch (err) {
      setError(`Lookup failed: ${err.message}`);
    } finally {
      setIsManualLoading(false);
    }
  }

  // ── Disambiguation handlers ───────────────────────────────────────────────────
  function handleDisambigAccept(item) {
    setDisambigQueue(prev => prev.filter(i => i !== item));
    loadAndDisplayVerse(item);
  }
  function handleDisambigDismiss() {
    setDisambigQueue(prev => prev.slice(1));
  }

  // ── Translation dropdown ──────────────────────────────────────────────────────
  function handleTranslationChange(e) {
    const found = translations.find(t => t.id === e.target.value);
    if (found) setSelectedTranslation(found);
  }

  // ── Click-through handlers ────────────────────────────────────────────────────
  function handleSelectHistoryEntry(entry) {
    setCurrentVerse(entry);
    broadcastVerse(entry);
    setActiveTab('display');
  }

  function handleSelectCrossRef(ref) {
    if (ref.text) {
      // Verse text was pre-fetched when cross-refs were generated
      const verse = {
        book:       ref.book,
        chapter:    ref.chapter,
        verseStart: ref.verseStart,
        verseEnd:   ref.verseEnd,
        text:       ref.text,
        verses:     [],           // cross-refs store plain text only; verses array not available
        reference:  ref.reference,
        translationName: selectedTranslation.name,
        timestamp:  Date.now(),
      };
      setCurrentVerse(verse);
      broadcastVerse(verse);
      setActiveTab('display');
    } else {
      // Text wasn't pre-fetched (fetch failed earlier) — load it now
      loadAndDisplayVerse({
        book: ref.book, chapter: ref.chapter,
        verseStart: ref.verseStart, verseEnd: ref.verseEnd,
      });
    }
  }

  // ── Inline API.Bible key update ───────────────────────────────────────────────
  async function handleSaveApiBibleKey() {
    const key = keyPanelInput.trim();
    if (!key) return;
    setKeyPanelStatus('loading');
    try {
      const res = await fetch(`${APIBIBLE_BASE}/bibles`, { headers: { 'api-key': key } });
      if (!res.ok) throw new Error(`${res.status}`);
      localStorage.setItem(STORAGE_KEY_APIBIBLE, key);
      const newKeys = { ...apiKeys, apibible: key };
      setApiKeys(newKeys);
      const list = await loadTranslationList(key);
      setTranslations(list);
      setKeyPanelStatus('ok');
      setKeyPanelInput('');
      setTimeout(() => { setShowKeyPanel(false); setKeyPanelStatus(null); }, 1500);
    } catch {
      setKeyPanelStatus('error');
    }
  }

  // ── Reset all keys → return to setup screen ───────────────────────────────────
  function handleResetKeys() {
    if (!window.confirm('Clear saved API keys and return to setup?')) return;
    localStorage.removeItem(STORAGE_KEY_ANTHROPIC);
    localStorage.removeItem(STORAGE_KEY_APIBIBLE);
    stopListening();
    setIsSetup(false);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  if (!isSetup) return <SetupScreen onComplete={handleSetupComplete} />;

  // Tab labels and display mode labels are defined here so they're easy to edit.
  const TAB_LABELS    = { display: 'Verse', crossrefs: 'Cross-Refs', history: 'History', transcript: 'Transcript' };
  const DISPLAY_MODES = { projection: 'Projection', sidepanel: 'Side Panel', mobile: 'Mobile' };

  return (
    <div className="min-h-screen bg-[#0a1520] text-[#f5ead6] flex flex-col overflow-hidden">

      {/* Disambiguation modal — floats above everything */}
      <DisambiguationModal
        item={disambigQueue[0] ?? null}
        onAccept={handleDisambigAccept}
        onDismiss={handleDisambigDismiss}
      />

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <header className="bg-[#0d1b2a] border-b border-[#1e3050] px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">

        {/* Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-[#d4af37] text-xl select-none">✝</span>
          <span className="font-serif text-[#f5ead6] text-base hidden sm:block">Bible Display</span>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-2 text-xs font-sans">
          {isProcessingNLP && (
            <span className="bg-blue-900/50 text-blue-300 border border-blue-800 px-2 py-0.5 rounded-full animate-pulse">
              Detecting…
            </span>
          )}
          {isLoadingVerse && (
            <span className="bg-amber-900/50 text-amber-300 border border-amber-800 px-2 py-0.5 rounded-full animate-pulse">
              Loading…
            </span>
          )}
          <span className={`flex items-center gap-1.5 ${isListening ? 'text-green-400' : 'text-[#4a5a6a]'}`}>
            <span className={`w-2 h-2 rounded-full inline-block ${isListening ? 'bg-green-400 animate-pulse' : 'bg-[#3a4a5a]'}`} />
            {isListening ? 'Listening' : 'Paused'}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">

          {/* Translation picker */}
          <select
            value={selectedTranslation.id}
            onChange={handleTranslationChange}
            className="bg-[#1a2a3a] border border-[#243444] text-[#c8b89a] font-sans text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#d4af37] hidden sm:block max-w-[120px]"
          >
            {translations.length > FREE_TRANSLATIONS.length ? (
              <>
                <optgroup label="Free (always available)">
                  {FREE_TRANSLATIONS.map(t => (
                    <option key={t.id} value={t.id}>{t.abbreviation}</option>
                  ))}
                </optgroup>
                <optgroup label="API.Bible">
                  {translations.filter(t => t.source === 'apibible').map(t => (
                    <option key={t.id} value={t.id}>{t.abbreviation}</option>
                  ))}
                </optgroup>
              </>
            ) : (
              FREE_TRANSLATIONS.map(t => (
                <option key={t.id} value={t.id}>{t.abbreviation}</option>
              ))
            )}
          </select>

          {/* Display mode toggle (hidden on mobile) */}
          <div className="bg-[#1a2a3a] rounded-lg p-0.5 border border-[#243444] hidden md:flex">
            {Object.entries(DISPLAY_MODES).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setDisplayMode(mode)}
                className={`px-3 py-1 rounded-md font-sans text-xs transition-colors ${
                  displayMode === mode
                    ? 'bg-[#d4af37] text-[#0d1b2a] font-semibold'
                    : 'text-[#6a7a8a] hover:text-[#c8b89a]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Projection window toggle */}
          <button
            onClick={isProjectionOpen ? closeProjectionWindow : openProjectionWindow}
            className={`px-3 py-1.5 rounded-lg font-sans text-xs font-medium transition-colors border ${
              isProjectionOpen
                ? 'bg-[#d4af37]/15 border-[#d4af37]/40 text-[#d4af37]'
                : 'bg-[#1a2a3a] border-[#243444] text-[#6a7a8a] hover:text-[#c8b89a]'
            }`}
          >
            {isProjectionOpen ? '⊠ Screen' : '⊡ Screen'}
          </button>

          {/* Listen / Stop toggle */}
          <button
            onClick={isListening ? stopListening : startListening}
            className={`px-4 py-1.5 rounded-lg font-sans text-xs font-semibold transition-colors border ${
              isListening
                ? 'bg-red-950 hover:bg-red-900 text-red-300 border-red-800'
                : 'bg-green-950 hover:bg-green-900 text-green-300 border-green-800'
            }`}
          >
            {isListening ? 'Stop' : 'Listen'}
          </button>

          {/* Settings / API.Bible key panel toggle */}
          <button
            onClick={() => { setShowKeyPanel(p => !p); setKeyPanelStatus(null); setKeyPanelInput(''); }}
            title="Translation settings"
            className={`text-base leading-none px-1 transition-colors ${showKeyPanel ? 'text-[#d4af37]' : 'text-[#3a4a5a] hover:text-[#6a7a8a]'}`}
          >
            ⚙
          </button>
        </div>
      </header>

      {/* ── API.Bible key panel (slide-down) ─────────────────────────────────── */}
      {showKeyPanel && (
        <div className="bg-[#0d1b2a] border-b border-[#1e3050] px-4 py-3 shrink-0">
          <div className="max-w-xl flex flex-col gap-2">
            <p className="text-[#c8b89a] font-sans text-xs font-semibold uppercase tracking-wider">
              Unlock more translations (NIV, NKJV, Amplified, ESV…)
            </p>
            <p className="text-[#4a5a6a] font-sans text-xs">
              These are copyrighted and require an{' '}
              <span className="text-[#8a8a8a]">API.Bible</span> key (scripture.api.bible).
              {apiKeys.apibible && (
                <span className="text-green-500 ml-2">
                  ✓ Key saved — {translations.filter(t => t.source === 'apibible').length} extra translations loaded.
                </span>
              )}
            </p>
            <div className="flex gap-2 items-center">
              <input
                type="password"
                value={keyPanelInput}
                onChange={e => setKeyPanelInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveApiBibleKey()}
                placeholder={apiKeys.apibible ? 'Enter new key to replace…' : 'Paste your API.Bible key…'}
                className="flex-1 bg-[#1a2a3a] border border-[#243444] rounded-lg px-3 py-2 font-sans text-sm text-[#f5ead6] placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37]"
              />
              <button
                onClick={handleSaveApiBibleKey}
                disabled={!keyPanelInput.trim() || keyPanelStatus === 'loading'}
                className="bg-[#d4af37] hover:bg-[#c4a030] disabled:bg-[#3a3a1a] disabled:cursor-not-allowed text-[#0d1b2a] font-sans font-semibold px-4 py-2 rounded-lg text-sm transition-colors shrink-0"
              >
                {keyPanelStatus === 'loading' ? 'Saving…' : 'Save'}
              </button>
              {apiKeys.apibible && (
                <button
                  onClick={handleResetKeys}
                  className="text-[#4a5a6a] hover:text-red-400 font-sans text-xs transition-colors shrink-0"
                >
                  Reset all keys
                </button>
              )}
            </div>
            {keyPanelStatus === 'ok'    && <p className="text-green-400 font-sans text-xs">Key saved — translation list updated.</p>}
            {keyPanelStatus === 'error' && <p className="text-red-400  font-sans text-xs">Key rejected by API.Bible — check the key and try again.</p>}
          </div>
        </div>
      )}

      {/* ── Error banner ──────────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-950 border-b border-red-900 px-4 py-2 flex items-center justify-between gap-4 shrink-0">
          <p className="text-red-300 font-sans text-sm">{error}</p>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-400 text-lg leading-none">×</button>
        </div>
      )}

      {/* ── Body ──────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Main panel */}
        <main className={`flex flex-col flex-1 overflow-hidden ${displayMode === 'sidepanel' ? 'max-w-2xl border-r border-[#1e3050]' : ''}`}>

          {/* Tab bar */}
          <div className="flex border-b border-[#1e3050] bg-[#0d1b2a] shrink-0">
            {Object.entries(TAB_LABELS).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 font-sans text-xs font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
                  activeTab === tab
                    ? 'border-[#d4af37] text-[#d4af37]'
                    : 'border-transparent text-[#4a5a6a] hover:text-[#8a8a8a]'
                }`}
              >
                {label}
                {tab === 'crossrefs' && crossRefs.length > 0 && (
                  <span className="bg-[#d4af37]/20 text-[#d4af37] text-xs rounded-full px-1.5 py-px">
                    {crossRefs.length}
                  </span>
                )}
                {tab === 'history' && session.length > 0 && (
                  <span className="bg-[#1e3050] text-[#6a7a8a] text-xs rounded-full px-1.5 py-px">
                    {session.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col">

            {/* ── Verse tab ─────────────────────────────────────────────────── */}
            {activeTab === 'display' && (
              <>
                <VerseDisplay verse={currentVerse} mode={displayMode} />

                {/* Manual reference input + session controls */}
                <div className="pt-4 border-t border-[#1e3050] mt-auto">
                  <form onSubmit={handleManualSubmit} className="flex gap-2">
                    <input
                      type="text"
                      value={manualInput}
                      onChange={e => setManualInput(e.target.value)}
                      placeholder="Type a reference — e.g. John 3:16 or Romans 8"
                      className="flex-1 bg-[#1a2a3a] border border-[#243444] rounded-lg px-3 py-2 font-sans text-sm text-[#f5ead6] placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37]"
                    />
                    <button
                      type="submit"
                      disabled={isManualLoading || !manualInput.trim()}
                      className="bg-[#d4af37] hover:bg-[#c4a030] disabled:bg-[#3a3a1a] disabled:cursor-not-allowed text-[#0d1b2a] font-sans font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
                    >
                      {isManualLoading ? '…' : 'Go'}
                    </button>
                  </form>
                  {session.length > 0 && (
                    <div className="mt-2 flex gap-3">
                      <button
                        onClick={() => exportSession(session)}
                        className="text-[#4a5a6a] hover:text-[#8a8a8a] font-sans text-xs transition-colors"
                      >
                        Export session
                      </button>
                      <span className="text-[#2a3a4a]">·</span>
                      <button
                        onClick={() => { broadcastRef.current?.postMessage({ type: 'CLEAR' }); setCurrentVerse(null); }}
                        className="text-[#4a5a6a] hover:text-red-400 font-sans text-xs transition-colors"
                      >
                        Clear display
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── Cross-refs tab ─────────────────────────────────────────────── */}
            {activeTab === 'crossrefs' && (
              isLoadingXRefs
                ? <p className="text-center py-10 text-[#4a5a6a] font-sans text-sm animate-pulse">Generating cross-references…</p>
                : <CrossReferencePanel crossRefs={crossRefs} onSelectRef={handleSelectCrossRef} />
            )}

            {/* ── History tab ────────────────────────────────────────────────── */}
            {activeTab === 'history' && (
              <>
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <h3 className="text-[#5a6a7a] font-sans text-xs uppercase tracking-wider">Session History</h3>
                  {session.length > 0 && (
                    <button
                      onClick={() => exportSession(session)}
                      className="text-[#4a5a6a] hover:text-[#d4af37] font-sans text-xs transition-colors"
                    >
                      Export .txt
                    </button>
                  )}
                </div>
                <SessionHistory session={session} onSelectEntry={handleSelectHistoryEntry} />
              </>
            )}

            {/* ── Transcript tab ─────────────────────────────────────────────── */}
            {activeTab === 'transcript' && (
              <>
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <h3 className="text-[#5a6a7a] font-sans text-xs uppercase tracking-wider">Live Transcript</h3>
                  <button
                    onClick={() => { transcriptChunksRef.current = []; setLiveTranscript(''); }}
                    className="text-[#4a5a6a] hover:text-red-400 font-sans text-xs transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="bg-[#0d1b2a] border border-[#1e3050] rounded-xl p-4 flex-1 overflow-y-auto min-h-[200px]">
                  {liveTranscript
                    ? <p className="text-[#c8b89a] font-serif text-sm leading-relaxed whitespace-pre-wrap">{liveTranscript}</p>
                    : <p className="text-[#3a4a5a] font-serif text-sm italic">Transcript will appear here while listening…</p>
                  }
                </div>
              </>
            )}
          </div>
        </main>

        {/* ── Side panel (cross-refs alongside verse) ──────────────────────── */}
        {displayMode === 'sidepanel' && (
          <aside className="w-80 bg-[#0d1b2a] flex flex-col overflow-hidden shrink-0">
            <div className="px-4 py-3 border-b border-[#1e3050] shrink-0">
              <h3 className="text-[#d4af37] font-sans text-xs uppercase tracking-widest font-semibold">
                Cross-References
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {isLoadingXRefs
                ? <p className="text-center py-8 text-[#4a5a6a] font-sans text-sm animate-pulse">Generating…</p>
                : <CrossReferencePanel crossRefs={crossRefs} onSelectRef={handleSelectCrossRef} />
              }
            </div>
          </aside>
        )}
      </div>

      {/* ── Mobile bottom navigation ──────────────────────────────────────────── */}
      {displayMode === 'mobile' && (
        <nav className="bg-[#0d1b2a] border-t border-[#1e3050] flex justify-around py-2 shrink-0">
          {['display', 'crossrefs', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex flex-col items-center gap-0.5 px-4 py-1 rounded-lg font-sans text-xs transition-colors ${
                activeTab === tab ? 'text-[#d4af37]' : 'text-[#4a5a6a]'
              }`}
            >
              <span className="text-lg">
                {tab === 'display' ? '📖' : tab === 'crossrefs' ? '🔗' : '📋'}
              </span>
              <span>{TAB_LABELS[tab]}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
