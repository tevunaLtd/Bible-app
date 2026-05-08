/**
 * test-navigation.mjs — navigation command tests
 * No Anthropic API key needed — Anthropic calls are mocked in-browser.
 * Run: node test-navigation.mjs
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3000';

const browser = await chromium.launch({ headless: false });
const ctx  = await browser.newContext();
const page = await ctx.newPage();

// ── Inject local mode + mock Anthropic fetch ─────────────────────────────────
await page.addInitScript(() => {
  localStorage.setItem('bible_app_local_mode', 'true');
  localStorage.setItem('bible_app_anthropic_key', 'sk-ant-test-key');

  const _fetch = window.fetch;
  window.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('api.anthropic.com')) {
      const body   = JSON.parse(opts?.body ?? '{}');
      const chunk  = body?.messages?.[0]?.content ?? '';
      const m      = chunk.match(/(\w[\w\s]*?)\s+(\d+):(\d+)/);
      const ref    = m
        ? { book: m[1].trim(), chapter: +m[2], verseStart: +m[3], verseEnd: +m[3] }
        : { book: 'John', chapter: 3, verseStart: 16, verseEnd: 16 };
      const payload = { references: [{ raw: chunk, ...ref, confidence: 0.99, isPartial: false }] };
      return new Response(
        JSON.stringify({ content: [{ text: JSON.stringify(payload) }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return _fetch(url, opts);
  };
});

await page.goto(`${BASE}/operator`);
await page.waitForTimeout(2000);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getRef() {
  const all = await page.locator('p').filter({ hasText: /\w+ \d+:\d+/ }).allTextContents().catch(() => []);
  return all[0]?.trim() ?? null;
}

async function getError() {
  return page.locator('.bg-red-950 p').first().textContent({ timeout: 800 }).catch(() => null);
}

async function enter(text) {
  await page.getByPlaceholder('Type a reference').fill(text);
  await page.getByPlaceholder('Type a reference').press('Enter');
}

/** Enter a command, then wait until the displayed reference becomes `expected` (or timeout). */
async function enterExpect(text, expected) {
  await enter(text);
  await page.waitForFunction(
    (exp) => [...document.querySelectorAll('p')]
      .some(p => p.textContent.trim() === exp),
    expected,
    { timeout: 7000 }
  ).catch(() => {});
  return getRef();
}

/** Enter a command and wait a fixed time (for cases where the ref shouldn't change). */
async function enterWait(text, ms = 4000) {
  await enter(text);
  await page.waitForTimeout(ms);
  return getRef();
}

const results = [];
function log(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'}  ${label}${detail ? '  →  ' + detail : ''}`);
  results.push({ label, ok });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
console.log('\n[1] Load John 3:16');
const r1 = await enterExpect('John 3:16', 'John 3:16');
log('John 3:16 loaded', r1 === 'John 3:16', r1 ?? '(nothing)');

console.log('\n[2] "next verse"  (expect 3:17)');
const r2 = await enterExpect('next verse', 'John 3:17');
log('"next verse" → 3:17', r2 === 'John 3:17', r2);

console.log('\n[3] "next"  (expect 3:18)');
const r3 = await enterExpect('next', 'John 3:18');
log('"next" → 3:18', r3 === 'John 3:18', r3);

console.log('\n[4] "previous verse"  (expect 3:17)');
const r4 = await enterExpect('previous verse', 'John 3:17');
log('"previous verse" → 3:17', r4 === 'John 3:17', r4);

console.log('\n[5] "go back"  (expect 3:16)');
const r5 = await enterExpect('go back', 'John 3:16');
log('"go back" → 3:16', r5 === 'John 3:16', r5);

console.log('\n[6] "next chapter"  (expect John 4:1)');
const r6 = await enterExpect('next chapter', 'John 4:1');
log('"next chapter" → John 4:1', r6 === 'John 4:1', r6);

console.log('\n[7] "previous chapter"  (expect John 3:1)');
const r7 = await enterExpect('previous chapter', 'John 3:1');
log('"previous chapter" → John 3:1', r7 === 'John 3:1', r7);

console.log('\n[8] "go back" at verse 1 (clamp — ref stays 3:1)');
const r8 = await enterWait('go back', 3000);
log('"go back" clamped at 3:1', r8 === 'John 3:1', r8);

console.log('\n[9] "first verse"  (from 3:1, expect 3:1)');
const r9 = await enterWait('first verse', 3000);
log('"first verse" → 3:1', r9 === 'John 3:1', r9);

console.log('\n[10] Load John 3:18 then "first verse"  (expect 3:1)');
await enterExpect('John 3:18', 'John 3:18');
const r10 = await enterExpect('first verse', 'John 3:1');
log('"first verse" from 3:18 → 3:1', r10 === 'John 3:1', r10);

console.log('\n[11] "last verse"  (John 3 has 36 verses → expect 3:36)');
const r11 = await enterExpect('last verse', 'John 3:36');
log('"last verse" → John 3:36', r11 === 'John 3:36', r11);

console.log('\n[12] "first chapter"  (expect John 1:1)');
const r12 = await enterExpect('first chapter', 'John 1:1');
log('"first chapter" → John 1:1', r12 === 'John 1:1', r12);

console.log('\n[13] "last chapter"  (John has 21 chapters → expect John 21:1)');
const r13 = await enterExpect('last chapter', 'John 21:1');
log('"last chapter" → John 21:1', r13 === 'John 21:1', r13);

console.log('\n[14] John 3:999 → "not available"');
await enter('John 3:999');
await page.waitForTimeout(5000);
const err14 = await getError();
log('Shows "not available"', /not available/i.test(err14 ?? ''), err14 ?? '(no error shown)');

// ── Summary ───────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`\n${'─'.repeat(52)}`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log(`${'─'.repeat(52)}\n`);

await page.waitForTimeout(2000);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
