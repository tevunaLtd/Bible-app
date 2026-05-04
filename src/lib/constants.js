// ── Claude models ────────────────────────────────────────────
export const DETECT_MODEL  = 'claude-haiku-4-5-20251001'; // fast, for live detection
export const XREF_MODEL    = 'claude-sonnet-4-6';          // smarter, for cross-references

// ── API endpoints ────────────────────────────────────────────
export const ANTHROPIC_API   = 'https://api.anthropic.com/v1/messages';
export const APIBIBLE_BASE   = 'https://api.scripture.api.bible/v1';
export const FREE_BIBLE_BASE = 'https://bible-api.com';

// ── Voice / NLP tuning ───────────────────────────────────────
export const CONFIDENCE_THRESHOLD = 0.7;
export const TRANSCRIPT_WINDOW_MS = 10 * 60 * 1000;
export const MAX_CONTEXT_PASSAGES = 5;
export const CHUNK_WORD_LIMIT     = 50;
export const CHUNK_SILENCE_MS     = 1500;

// ── Translations available without any API key ───────────────
// IDs must match bible-api.com translation IDs.
export const FREE_TRANSLATIONS = [
  { id: 'kjv',   name: 'King James Version',          abbreviation: 'KJV',   source: 'free' },
  { id: 'web',   name: 'World English Bible',          abbreviation: 'WEB',   source: 'free' },
  { id: 'asv',   name: 'American Standard Version',    abbreviation: 'ASV',   source: 'free' },
  { id: 'bbe',   name: 'Bible in Basic English',        abbreviation: 'BBE',   source: 'free' },
  { id: 'darby', name: 'Darby Translation',             abbreviation: 'Darby', source: 'free' },
  { id: 'ylt',   name: "Young's Literal Translation",   abbreviation: 'YLT',  source: 'free' },
];

// ── API.Bible book ID map ────────────────────────────────────
export const BOOK_IDS = {
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

// ── Cross-reference tag colours ──────────────────────────────
export const XREF_TAG_COLORS = {
  'Prophecy/Fulfillment': 'bg-purple-900 text-purple-200 border-purple-700',
  'Thematic Echo':        'bg-blue-900   text-blue-200   border-blue-700',
  'Same Author':          'bg-emerald-900 text-emerald-200 border-emerald-700',
  'Doctrinal Parallel':   'bg-amber-900  text-amber-200  border-amber-700',
  'Narrative Parallel':   'bg-rose-900   text-rose-200   border-rose-700',
};
