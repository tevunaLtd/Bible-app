/**
 * claudeApi.js — Claude API calls for reference detection and cross-references.
 * Both functions require an Anthropic API key (loaded from church settings).
 */

import { ANTHROPIC_API, DETECT_MODEL, XREF_MODEL } from './constants';

const HEADERS = (key) => ({
  'Content-Type':  'application/json',
  'x-api-key':     key,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
});

function parseJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude returned no JSON');
  return JSON.parse(match[0]);
}

/**
 * Detect Bible references in a spoken chunk.
 * Returns { references: [{ raw, book, chapter, verseStart, verseEnd, confidence, isPartial }] }
 */
export async function claudeDetectReferences(anthropicKey, transcriptContext, passageContext, chunk) {
  const res = await fetch(ANTHROPIC_API, {
    method:  'POST',
    headers: HEADERS(anthropicKey),
    body: JSON.stringify({
      model:      DETECT_MODEL,
      max_tokens: 256,
      system:     'You are a Bible reference detector for live sermon transcription. Find Bible references—explicit or implicit—in spoken chunks. Return valid JSON only, no markdown.',
      messages: [{
        role:    'user',
        content: `Rolling transcript:\n${transcriptContext || '(none)'}\n\nRecent passages:\n${passageContext || '(none)'}\n\nNew chunk:\n"${chunk}"\n\nReturn JSON:\n{"references":[{"raw":"spoken words","book":"John","chapter":3,"verseStart":16,"verseEnd":16,"confidence":0.95,"isPartial":false}]}\n\nRules: confidence 0–1, include only >=0.5, return {"references":[]} if none found.`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseJson(data.content?.[0]?.text?.trim() ?? '');
}

/**
 * Generate 3–5 cross-references for a displayed passage.
 * Returns { crossReferences: [{ reference, book, chapter, verseStart, verseEnd, tag, reason }] }
 * tag must be one of the keys in XREF_TAG_COLORS.
 */
export async function claudeGenerateCrossRefs(anthropicKey, reference, verseText) {
  const res = await fetch(ANTHROPIC_API, {
    method:  'POST',
    headers: HEADERS(anthropicKey),
    body: JSON.stringify({
      model:      XREF_MODEL,
      max_tokens: 512,
      system:     'You are a Bible scholar generating cross-references for live sermon display. Return valid JSON only, no markdown.',
      messages: [{
        role:    'user',
        content: `Passage: ${reference}\nText: "${verseText}"\n\nGenerate 3–5 cross-references. Return JSON:\n{"crossReferences":[{"reference":"Romans 8:28","book":"Romans","chapter":8,"verseStart":28,"verseEnd":28,"tag":"Doctrinal Parallel","reason":"One sentence."}]}\n\ntag must be one of: "Prophecy/Fulfillment","Thematic Echo","Same Author","Doctrinal Parallel","Narrative Parallel".`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseJson(data.content?.[0]?.text?.trim() ?? '');
}
