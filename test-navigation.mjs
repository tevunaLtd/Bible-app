/**
 * test-navigation.mjs — navigation command tests
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node test-navigation.mjs
 *
 * Runs against the dev server at http://localhost:3000 using local mode
 * (no Supabase login required). An Anthropic key is needed to load the
 * initial verse via the manual input; navigation commands need no key.
 */
import { chromium } from '@playwright/test';

const BASE        = 'http://localhost:3000';
const ANTH_KEY    = process.env.ANTHROPIC_API_KEY ?? '';
const INPUT_PH    = 'Type a reference';
const WAIT_VERSE  = 5000;   // ms — allow API round-trip for verse load
const WAIT_NAV    = 3000;   // ms — nav is local, just needs re-render

if (!ANTH_KEY) {
  console.error('Set ANTHROPIC_API_KEY=sk-ant-... to run this test.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const ctx  = await browser.newContext();
const page = await ctx.newPage();

// ── Inject local mode + Anthropic key before the page loads ─────────────────
await page.addInitScript(({ key }) => {
  localStorage.setItem('bible_app_local_mode', 'true');
  localStorage.setItem('bible_app_anthropic_key', key);
}, { key: ANTH_KEY });

await page.goto(`${BASE}/operator`);
await page.waitForTimeout(2000);

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getRef() {
  // VerseDisplay renders reference as: <p class="font-semibold text-lg tracking-wide">John 3:16</p>
  const el = page.locator('p').filter({ hasText: /\w+ \d+:\d+/ }).first();
  return el.textContent({ timeout: 1000 }).catch(() => null);
}

async function getError() {
  return page.locator('[class*="red"] p, [class*="red-300"]').first()
    .textContent({ timeout: 500 }).catch(() => null);
}

async function enter(text) {
  const input = page.getByPlaceholder(INPUT_PH);
  await input.fill(text);
  await input.press('Enter');
}

const results = [];
function log(label, ok, detail = '') {
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark}  ${label}${detail ? '  →  ' + detail : ''}`);
  results.push({ label, ok });
}

// ── 1. Load starting verse via Claude ────────────────────────────────────────
console.log('\n[1] Load John 3:16');
await enter('John 3:16');
await page.waitForTimeout(WAIT_VERSE);
const ref1 = await getRef();
log('John 3:16 loaded', !!ref1, ref1 ?? '(nothing visible)');

// ── 2. next verse ─────────────────────────────────────────────────────────────
console.log('\n[2] "next verse"');
await enter('next verse');
await page.waitForTimeout(WAIT_NAV);
const ref2 = await getRef();
log('"next verse" → 3:17', ref2?.includes('17'), ref2);

// ── 3. next ───────────────────────────────────────────────────────────────────
console.log('\n[3] "next"');
await enter('next');
await page.waitForTimeout(WAIT_NAV);
const ref3 = await getRef();
log('"next" → 3:18', ref3?.includes('18'), ref3);

// ── 4. previous verse ─────────────────────────────────────────────────────────
console.log('\n[4] "previous verse"');
await enter('previous verse');
await page.waitForTimeout(WAIT_NAV);
const ref4 = await getRef();
log('"previous verse" → 3:17', ref4?.includes('17'), ref4);

// ── 5. go back ────────────────────────────────────────────────────────────────
console.log('\n[5] "go back"');
await enter('go back');
await page.waitForTimeout(WAIT_NAV);
const ref5 = await getRef();
log('"go back" → 3:16', ref5?.includes('16'), ref5);

// ── 6. next chapter ───────────────────────────────────────────────────────────
console.log('\n[6] "next chapter"');
await enter('next chapter');
await page.waitForTimeout(WAIT_VERSE);
const ref6 = await getRef();
log('"next chapter" → John 4:1', ref6?.includes('4') && ref6?.includes('1'), ref6);

// ── 7. previous chapter ───────────────────────────────────────────────────────
console.log('\n[7] "previous chapter"');
await enter('previous chapter');
await page.waitForTimeout(WAIT_VERSE);
const ref7 = await getRef();
log('"previous chapter" → John 3:1', ref7?.includes('3') && ref7?.includes('1'), ref7);

// ── 8. clamp at verse 1 ──────────────────────────────────────────────────────
console.log('\n[8] "go back" at verse 1 (clamp)');
await enter('go back');
await page.waitForTimeout(WAIT_NAV);
const ref8 = await getRef();
log('"go back" at v1 stays at 3:1', ref8?.includes('3:1'), ref8);

// ── 9. out-of-range: friendly error ──────────────────────────────────────────
console.log('\n[9] Out-of-range verse → friendly error');
await enter('John 3:999');
await page.waitForTimeout(WAIT_VERSE);
const err9 = await getError();
log('Shows "not available"', /not available/i.test(err9 ?? ''), err9 ?? '(no error shown)');

// ── Summary ───────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`\n${'─'.repeat(52)}`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log(`${'─'.repeat(52)}\n`);

await page.waitForTimeout(2000);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
