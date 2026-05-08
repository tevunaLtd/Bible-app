/**
 * bibleApi.js
 *
 * All Bible content fetching. Every function returns:
 *   { text: string, verses: { verseNumber: number, text: string }[] }
 *
 * text   — full combined text (used for Claude context, export)
 * verses — one entry per verse number (used for separated display)
 */

import { FREE_TRANSLATIONS, BOOK_IDS, APIBIBLE_BASE, FREE_BIBLE_BASE } from './constants';

// Session-level cache — prevents duplicate API calls.
// Key: "translationId:book:chapter:verseStart:verseEnd"
const verseCache = new Map();

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').trim();
}

// ── Free source (bible-api.com) ──────────────────────────────

export async function fetchFromFreeApi(translationId, book, chapter, verseStart, verseEnd) {
  const vs       = verseStart || 1;
  const ve       = verseEnd ?? vs;
  const range    = ve !== vs ? `${vs}-${ve}` : `${vs}`;
  const bookPath = book.toLowerCase().replace(/\s+/g, '+');
  const url      = `${FREE_BIBLE_BASE}/${bookPath}+${chapter}:${range}?translation=${translationId}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`bible-api.com ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  const verses = (data.verses ?? [])
    .map(v => ({ verseNumber: v.verse, text: v.text.trim().replace(/\n+/g, ' ') }))
    .filter(v => v.text);

  const text = verses.length
    ? verses.map(v => v.text).join(' ')
    : (data.text ?? '').trim().replace(/\n+/g, ' ');

  if (!text) throw new Error('Empty response from bible-api.com');
  return { text, verses };
}

// ── API.Bible (keyed, 80+ translations) ──────────────────────

export async function fetchFromApiBible(apiKey, bibleId, book, chapter, verseStart, verseEnd) {
  const bookId = BOOK_IDS[book];
  if (!bookId) throw new Error(`Unknown book: ${book}`);

  const vs        = verseStart || 1;
  const ve        = verseEnd ?? vs;
  const startId   = `${bookId}.${chapter}.${vs}`;
  const endId     = `${bookId}.${chapter}.${ve}`;
  const passageId = startId === endId ? startId : `${startId}-${endId}`;

  const params = [
    'content-type=text', 'include-notes=false', 'include-titles=false',
    'include-chapter-numbers=false', 'include-verse-numbers=true', 'include-verse-spans=false',
  ].join('&');

  const res = await fetch(
    `${APIBIBLE_BASE}/bibles/${bibleId}/passages/${passageId}?${params}`,
    { headers: { 'api-key': apiKey } }
  );
  if (!res.ok) throw new Error(`API.Bible ${res.status}`);
  const data = await res.json();
  const raw  = stripHtml(data.data?.content ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) throw new Error('Empty passage from API.Bible');

  // Parse "[16] text [17] text" markers embedded by API.Bible
  const verses = [];
  const re = /\[(\d+)\]\s*([^[]+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const t = m[2].trim();
    if (t) verses.push({ verseNumber: parseInt(m[1], 10), text: t });
  }

  const text = verses.length ? verses.map(v => v.text).join(' ') : raw;
  return { text, verses };
}

// ── Translation list ─────────────────────────────────────────

export async function loadTranslationList(apiBibleKey) {
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

// ── Main fetch (cached) ──────────────────────────────────────

export async function fetchVerseContent(apiBibleKey, translation, book, chapter, verseStart, verseEnd) {
  const ve       = verseEnd ?? verseStart;
  const cacheKey = `${translation.id}:${book}:${chapter}:${verseStart}:${ve}`;

  if (verseCache.has(cacheKey)) return verseCache.get(cacheKey);

  let result;
  if (translation.source === 'apibible' && apiBibleKey) {
    try {
      result = await fetchFromApiBible(apiBibleKey, translation.id, book, chapter, verseStart, ve);
    } catch (err) {
      console.warn('API.Bible failed, falling back:', err.message);
    }
  }

  if (!result) {
    const freeId = translation.source === 'free' ? translation.id : 'kjv';
    result = await fetchFromFreeApi(freeId, book, chapter, verseStart, ve);
  }

  verseCache.set(cacheKey, result);
  return result;
}

// ── Helpers ──────────────────────────────────────────────────

export function formatReference(ref) {
  if (!ref) return '';
  const { book, chapter, verseStart, verseEnd } = ref;
  if (!verseEnd || verseStart === verseEnd) return `${book} ${chapter}:${verseStart}`;
  return `${book} ${chapter}:${verseStart}–${verseEnd}`;
}

export function buildTranscriptContext(chunks, windowMs) {
  const cutoff = Date.now() - windowMs;
  return chunks.filter(c => c.timestamp > cutoff).map(c => c.text).join(' ');
}

export function buildPassageContext(passages, max) {
  return passages
    .slice(-max)
    .map(p => `${formatReference(p)}: "${p.text.slice(0, 120)}"`)
    .join('\n');
}

export function exportSessionText(session) {
  const lines = ['BIBLE DISPLAY — SESSION EXPORT', '='.repeat(50), ''];
  session.forEach(entry => {
    const time = new Date(entry.timestamp || entry.displayed_at).toLocaleTimeString();
    lines.push(`[${time}] ${entry.reference} (${entry.translation_name || entry.translationName})`);
    lines.push(entry.verse_text || entry.text);
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href:     url,
    download: `sermon-${new Date().toISOString().split('T')[0]}.txt`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
