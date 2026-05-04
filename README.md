# Bible Display — Production README

> Voice-powered, real-time scripture display system for live church services.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Tech Stack](#3-tech-stack)
4. [Folder Structure](#4-folder-structure)
5. [Feature Breakdown](#5-feature-breakdown)
6. [Database Schema](#6-database-schema)
7. [API Documentation](#7-api-documentation)
8. [Business Logic](#8-business-logic)
9. [Key Workflows](#9-key-workflows)
10. [Environment Setup](#10-environment-setup)
11. [Deployment](#11-deployment)
12. [Known Issues / Limitations](#12-known-issues--limitations)
13. [Future Improvements / Roadmap](#13-future-improvements--roadmap)
14. [Contribution Guidelines](#14-contribution-guidelines)

---

## 1. Project Overview

### Problem

During live church services, preachers reference Bible passages verbally. Displaying those passages to the congregation in real time currently requires a dedicated technician watching the sermon and manually searching for each reference — a process that is slow, error-prone, and requires expert Bible knowledge.

### Solution

Bible Display listens to the sermon via the browser's Speech Recognition API, uses Claude AI to detect scripture references in the spoken transcript, fetches the passage from a Bible API, and pushes it simultaneously to:

- A full-screen **projection window** (second monitor / HDMI projector)
- A **congregation view** accessible on any device via a QR-code URL
- An embedded **operator preview** so the preacher or tech operator can confirm before displaying

All three views stay in sync via Supabase Realtime with sub-second latency.

### Primary Users

| User | Role | Interface |
|------|------|-----------|
| Preacher / Tech operator | Runs the service, controls what's on screen | `/operator` |
| Congregation member | Follows along on their phone | `/c/:slug` |
| Projectionist | Receives output on a second screen | `/projection/:id` |
| Church administrator | Manages churches, users, branding | `/admin` |

### Use Cases

- **Automatic detection**: Preacher speaks, system detects and displays with no manual input.
- **Manual lookup**: Operator types a reference (e.g. `John 3:16-18`) for instant display.
- **Text selection**: Operator highlights any spoken text, popup previews the detected passage, one click to display.
- **Cross-references**: After every verse, Claude Sonnet generates 3–5 related passages with semantic tags (Prophecy/Fulfillment, Thematic Echo, etc.) for the operator to optionally display.
- **Sermon archive**: Every session is logged; operators can browse, replay, and export past sermons.
- **Multi-church**: A single organisation can manage multiple churches under one account, each with its own branding, URL slug, and API keys.

---

## 2. Architecture Overview

### System Design

```
┌─────────────────────────────────────────────────────────┐
│                     CLIENT (React SPA)                   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ OperatorPage │  │CongregationPg│  │ProjectionPage │ │
│  │  (protected) │  │   (public)   │  │   (public)    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘ │
│         │                 │                  │          │
│  ┌──────▼─────────────────▼──────────────────▼────────┐ │
│  │               AuthContext / Supabase client        │ │
│  └──────────────────────────┬──────────────────────── ┘ │
└─────────────────────────────┼───────────────────────────┘
                              │ HTTPS / WebSocket
        ┌─────────────────────┼───────────────────┐
        │                     │                   │
        ▼                     ▼                   ▼
  ┌──────────┐       ┌──────────────┐    ┌──────────────┐
  │ Supabase │       │  Anthropic   │    │  Bible APIs  │
  │  (auth + │       │  Claude API  │    │  (content)   │
  │  realtime│       │  (AI models) │    │              │
  │  + RLS)  │       └──────────────┘    └──────────────┘
  └──────────┘
```

### Data Flow: Verse Display

```
Microphone
    │
    ▼
Web Speech API (browser, Chrome/Edge only)
    │  spoken words, chunked every 50 words or 1.5s silence
    ▼
claudeDetectReferences()  ← Claude Haiku (fast, cheap)
    │  returns { references: [{ book, chapter, verse, confidence }] }
    ▼
confidence ≥ 0.7? ──No──► confidence ≥ 0.5? ──Yes──► DisambiguationModal
    │                                                  (user confirms)
   Yes
    │
    ▼
fetchVerseContent()  ← API.Bible (keyed) or bible-api.com (free fallback)
    │  returns { text, verses: [{ verseNumber, text }] }
    ▼
setCurrentVerse()  ─────────────────────────────────►  ProjectionPreview (local)
    │
    ▼
pushVerseToSupabase()  →  live_sessions table (upsert)
    │                        │
    │                        ▼
    │                 Supabase Realtime broadcasts UPDATE
    │                        │
    │               ┌────────┴────────┐
    │               ▼                 ▼
    │       CongregationPage    ProjectionPage
    │       (phones/tablets)   (second monitor)
    │
    ▼
sermon_verses INSERT (async, non-blocking)
    │
    ▼
claudeGenerateCrossRefs()  ← Claude Sonnet (background, non-blocking)
```

### Multi-Tenancy Model

```
Organization  (e.g. "Tevuna Ltd")
    └── Church A  (e.g. "Grace Chapel")
    │       └── live_session (one row, upserted on every push)
    │       └── sermons[]
    │           └── sermon_verses[]
    └── Church B  (e.g. "Faith Community")
            └── live_session
            └── sermons[]
```

Each church has its own Congregation URL (`/c/:slug`), projection URL (`/projection/:id`), branding colours, logo, and API keys. Operators log in to a shared Supabase project but RLS policies restrict all reads/writes to their assigned church.

---

## 3. Tech Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Frontend framework | React | 18.2 | Hooks only, no class components |
| Build tool | Vite | 5.4 | ESM-native, HMR |
| Routing | React Router | 7.x | `BrowserRouter`, no hash routing |
| Styling | Tailwind CSS | 3.4 | Utility-first; custom `animate-fade-in` keyframe |
| Backend / Auth | Supabase | 2.x JS client | PostgreSQL + GoTrue + Realtime |
| AI — detection | Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | Fast, low-latency NLP |
| AI — cross-refs | Claude Sonnet 4.6 | `claude-sonnet-4-6` | Higher reasoning quality |
| Bible content (free) | bible-api.com | — | KJV, WEB, ASV, BBE, Darby, YLT |
| Bible content (keyed) | API.Bible | v1 | 80+ English translations (NIV, ESV, NKJV, …) |
| Font | EB Garamond | — | Google Fonts; `font-serif` class maps to it |
| Package manager | npm | — | `package-lock.json` is the lock file |

**No server-side code.** The entire application runs in the browser. Claude and Bible APIs are called directly from the client using CORS-permitted headers. Supabase handles auth, database, and realtime over its REST and WebSocket APIs.

---

## 4. Folder Structure

```
Bible App/
├── index.html                  # Root HTML; loads EB Garamond font
├── vite.config.js              # Vite config; default port 3000
├── tailwind.config.js          # Tailwind; custom fade-in animation
├── postcss.config.js
├── package.json
├── .env                        # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (gitignored)
├── .gitignore
│
├── supabase/
│   └── schema.sql              # Full DB schema — run once in Supabase SQL Editor
│
└── src/
    ├── main.jsx                # ReactDOM.createRoot entry point
    ├── index.css               # Tailwind directives (@tailwind base/components/utilities)
    │
    ├── App.jsx                 # BrowserRouter + route definitions + ProtectedRoute guard
    │
    ├── contexts/
    │   └── AuthContext.jsx     # session, profile, church state; local mode support
    │
    ├── lib/
    │   ├── supabase.js         # createClient() — single shared Supabase instance
    │   ├── constants.js        # Model IDs, API URLs, tuning params, FREE_TRANSLATIONS, BOOK_IDS
    │   ├── bibleApi.js         # fetchVerseContent(), loadTranslationList(), exportSessionText()
    │   └── claudeApi.js        # claudeDetectReferences(), claudeGenerateCrossRefs()
    │
    ├── pages/
    │   ├── LoginPage.jsx       # Email/password auth + "Use locally" local mode
    │   ├── SetupPage.jsx       # First-run wizard: org → church → API keys
    │   ├── OperatorPage.jsx    # Main operator interface (voice, display, archive)
    │   ├── AdminPage.jsx       # Church/user management (org_admin+ only)
    │   ├── ArchivePage.jsx     # Browse + export past sermons
    │   ├── CongregationPage.jsx# Public phone view (/c/:slug)
    │   └── ProjectionPage.jsx  # Public full-screen projector (/projection/:id)
    │
    └── components/
        ├── VerseDisplay.jsx        # Renders single or multi-verse; adapts to display mode
        ├── CrossReferencePanel.jsx # List of AI-generated cross-references with tags
        ├── DisambiguationModal.jsx # Fullscreen modal for low-confidence references
        ├── SelectionPopup.jsx      # Floating tooltip on text selection → verse preview
        └── ProjectionPreview.jsx   # Embedded 16:9 projection preview in operator UI
```

### Key Design Decisions

- **`lib/` is UI-agnostic.** All API calls and data transformation live in `lib/`. Pages import from `lib/` but `lib/` never imports from pages or components.
- **`constants.js` is the single source of truth** for model names, API endpoints, and all tuning thresholds. Change a model or threshold in one place.
- **No state management library.** React `useState`/`useRef`/`useCallback` with context for auth. The app is small enough that global state via context is sufficient.

---

## 5. Feature Breakdown

### 5.1 Voice Recognition & Transcript Chunking

**File:** `src/pages/OperatorPage.jsx` — `startListening()`, `flushChunkBuffer()`

The Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) runs continuously in the browser. The operator presses **Listen** to start.

Speech results are accumulated in `chunkBufferRef`. A chunk is flushed to Claude when either:
- The buffer reaches `CHUNK_WORD_LIMIT` (50 words), or
- `CHUNK_SILENCE_MS` (1500 ms) elapses since the last word

This dual trigger prevents both overly short (too many API calls) and overly long (missed real-time detection) chunks.

The last 10 minutes of transcript chunks (`TRANSCRIPT_WINDOW_MS`) are kept as rolling context. Up to 5 recent passages (`MAX_CONTEXT_PASSAGES`) are also passed to Claude so it can resolve ambiguous references like "that same verse" or "as we saw in Romans".

### 5.2 AI Reference Detection

**File:** `src/lib/claudeApi.js` — `claudeDetectReferences()`  
**Model:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)

Called on every flushed chunk. The prompt includes:
1. Rolling transcript context (last 10 min)
2. Recent passage context (last 5 verses displayed)
3. The new spoken chunk

Returns structured JSON:
```json
{
  "references": [
    {
      "raw": "John three sixteen",
      "book": "John",
      "chapter": 3,
      "verseStart": 16,
      "verseEnd": 16,
      "confidence": 0.95,
      "isPartial": false
    }
  ]
}
```

**Confidence routing:**
- `≥ 0.7` → fetch and display immediately
- `0.5–0.69` → add to disambiguation queue → `DisambiguationModal`
- `< 0.5` → silently discard

A `processingLockRef` prevents concurrent lookups from overlapping.

### 5.3 Bible Content Fetching

**File:** `src/lib/bibleApi.js` — `fetchVerseContent()`

Two-tier fetch with automatic fallback:

1. **API.Bible** (if `apibible_key` is set and translation source is `'apibible'`)
   - Uses `BOOK_IDS` map to convert book names to 3-letter USFM IDs (`John` → `JHN`)
   - Requests passage as `JHN.3.16-JHN.3.18`
   - Parses `[16] text [17] text` verse-number markers from the plain-text response
   
2. **bible-api.com** (free, no key)
   - URL format: `https://bible-api.com/john+3:16-18?translation=kjv`
   - Returns `{ verses: [{ verse, text }] }` array

Both paths return a normalised `{ text: string, verses: [{verseNumber, text}][] }` object.

**Session cache:** Results are memoised in a `Map` keyed by `translationId:book:chapter:verseStart:verseEnd` for the lifetime of the browser session. Repeat lookups (cross-references, history re-display) make zero additional API calls.

### 5.4 Multi-Verse Display

Both `VerseDisplay` (operator) and `ProjectionPage` / `CongregationPage` (public) check `verse.verses.length > 1`. When true, each verse is rendered in a separate `<p>` with a superscript verse number, matching the traditional printed Bible format.

### 5.5 Cross-References

**File:** `src/lib/claudeApi.js` — `claudeGenerateCrossRefs()`  
**Model:** Claude Sonnet 4.6 (`claude-sonnet-4-6`)

Triggered after every verse display, non-blocking (does not delay the verse appearing on screen). Returns 3–5 cross-references, each with:

- `reference` — human-readable (e.g. `Romans 8:28`)
- `book / chapter / verseStart / verseEnd` — for fetching
- `tag` — one of five semantic categories (see `XREF_TAG_COLORS` in `constants.js`)
- `reason` — one-sentence explanation

Tag categories and their UI colours:

| Tag | Colour |
|-----|--------|
| Prophecy/Fulfillment | Purple |
| Thematic Echo | Blue |
| Same Author | Emerald |
| Doctrinal Parallel | Amber |
| Narrative Parallel | Rose |

Cross-references are shown in the **Cross-Refs** tab and the **Side Panel** display mode. Clicking one fetches and displays the cross-reference passage.

### 5.6 Text Selection Popup

**File:** `src/components/SelectionPopup.jsx`, wired in `OperatorPage.jsx` — `handleMouseUp()`

A `mouseup` listener on the entire operator page detects text selections longer than 3 characters. Clicks inside buttons, inputs, selects, and the popup itself are excluded.

On selection:
1. The selection's bounding rect determines the popup's `fixed` position (clamped to viewport).
2. Claude detects any reference in the selected text (confidence ≥ 0.5).
3. The verse is fetched and previewed in the popup.
4. **"Display on screen"** → calls `confirmSelectionVerse()`, which sets state, pushes to Supabase, and kicks off cross-reference generation.
5. Escape key or ✕ dismisses without displaying.

### 5.7 Projection Screen

**Operator preview:** `src/components/ProjectionPreview.jsx`  
An embedded 16:9 preview panel in the operator UI. Font size is controlled 1–5 via A−/A+ buttons. The preview updates instantly from `currentVerse` React state — no network round-trip.

**Full-screen window:** `src/pages/ProjectionPage.jsx`  
Opened via `window.open()` at `1920×1080`. Subscribes to `live_sessions` via Supabase Realtime. Accepts a `?fontSize=N` URL parameter so the operator's chosen font size is inherited. Uses CSS `clamp()` for responsive scaling across any resolution. Fades verses in with a 500 ms opacity + translate animation.

**Idle state:** When `is_cleared` is true, both preview and full-screen show the church logo or name at 18% opacity, preventing a blank projector.

### 5.8 Congregation View

**File:** `src/pages/CongregationPage.jsx`  
Public, no login required. Accessed at `/c/:slug`.

Loads church row by `slug`, then subscribes to `live_sessions WHERE church_id=eq.{id}`. Applies church white-label colours. Shows a **LIVE** pulsing badge in the header. Uses `maybeSingle()` (not `single()`) to avoid errors when no session exists yet.

### 5.9 Realtime Sync

`live_sessions` has one row per church (enforced by `UNIQUE` on `church_id`). The operator upserts this row on every verse push and on clear. `supabase_realtime` is enabled on the table (`ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions`).

Both `CongregationPage` and `ProjectionPage` subscribe to `postgres_changes` events filtered by `church_id`. Supabase broadcasts the full `payload.new` row; no secondary fetch is needed.

Cleanup: `useEffect` returns a cleanup function that calls `supabase.removeChannel(channel)`, preventing memory leaks and ghost subscriptions on unmount.

### 5.10 Sermon Archive

Every verse displayed is appended to `sermon_verses` (non-blocking, no UI delay). A sermon row is created automatically on first page load for the current date (`CURRENT_DATE`), or the existing one is found via a date-scoped query.

**Archive page** (`/archive`) lists all sermons for the current church sorted by date, shows verse count, and lets the operator click through to see every verse with timestamp. Exports to `.txt` via `exportSessionText()` which creates a `Blob` and triggers a browser download.

### 5.11 Authentication & Local Mode

**Cloud mode:** Standard Supabase email/password. A `handle_new_user()` trigger auto-creates a `profiles` row on signup. After login, `AuthContext` loads `profiles` then `churches` via Supabase REST.

**Local mode:** Activated by clicking "Use locally — no account" on the login page, which sets `localStorage.bible_app_local_mode = "true"`. `AuthContext` detects this flag synchronously at startup and immediately provides a synthetic session, profile (`church_id: 'local'`), and church object built from other `localStorage` keys. No Supabase calls are made. `signOut()` in local mode clears the flag and redirects to `/login`.

Local mode limitations: realtime sync (congregation/projection), sermon persistence, and admin features require cloud mode with the schema applied.

### 5.12 Admin Dashboard

**File:** `src/pages/AdminPage.jsx`  
Restricted to `org_admin` and `super_admin` roles (operators are redirected to `/operator` on mount).

Three tabs:
- **Churches** — create/edit/delete churches; `ChurchForm` handles both create (+ auto-creates `live_sessions` row) and edit
- **Operators** — assign users to churches; change roles via inline dropdowns
- **Settings** — rename organisation

### 5.13 Setup Wizard

**File:** `src/pages/SetupPage.jsx`  
Shown to cloud-mode users who have no `church_id` on their profile. Three-step form:

1. Create `organizations` row
2. Create `churches` row (with branding)
3. Validate Anthropic key (live API call), insert `live_sessions` row, update `profiles` with `org_id`, `church_id`, `role: 'org_admin'`

After completion, `refreshProfile()` re-reads from Supabase and React Router navigates to `/operator`.

---

## 6. Database Schema

> Run `supabase/schema.sql` once in the **Supabase SQL Editor** to create all tables, triggers, and policies.

### Table: `organizations`

Top-level white-label entity. One organisation can own many churches.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `name` | TEXT NOT NULL | Display name |
| `slug` | TEXT UNIQUE NOT NULL | URL-safe identifier |
| `logo_url` | TEXT | Optional |
| `created_at` | TIMESTAMPTZ | Default NOW() |

### Table: `churches`

Individual churches belonging to an organisation.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `org_id` | UUID FK → organizations | Cascade delete |
| `name` | TEXT NOT NULL | |
| `slug` | TEXT UNIQUE NOT NULL | Used in `/c/:slug` |
| `logo_url` | TEXT | |
| `primary_color` | TEXT | Default `#d4af37` (gold) |
| `bg_color` | TEXT | Default `#0d1b2a` (dark navy) |
| `text_color` | TEXT | Default `#f5ead6` (warm white) |
| `default_translation` | TEXT | Default `kjv` |
| `anthropic_key` | TEXT | Stored in DB; protected by RLS |
| `apibible_key` | TEXT | Optional; unlocks 80+ translations |
| `created_at` | TIMESTAMPTZ | |

### Table: `profiles`

Extends `auth.users`. One row per authenticated user. Created automatically by trigger on signup.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK → auth.users | Cascade delete |
| `org_id` | UUID FK → organizations | NULL until setup completes |
| `church_id` | UUID FK → churches | NULL until setup completes; NULL triggers `/setup` redirect |
| `role` | TEXT | `operator` \| `church_admin` \| `org_admin` \| `super_admin` |
| `full_name` | TEXT | Populated from signup metadata |
| `created_at` | TIMESTAMPTZ | |

### Table: `live_sessions`

One row per church. The single source of truth for what is currently displayed. Updated in real time; public read policy enables unauthenticated congregation/projection views.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `church_id` | UUID FK → churches UNIQUE | Enforces one row per church |
| `verse_text` | TEXT | Full combined text |
| `verse_reference` | TEXT | Human-readable (e.g. `John 3:16`) |
| `translation_name` | TEXT | |
| `verses` | JSONB | `[{verseNumber, text}]` array for multi-verse display |
| `is_cleared` | BOOLEAN | `true` = screen is blank |
| `updated_at` | TIMESTAMPTZ | Touched on every upsert |

### Table: `sermons`

Named sermon sessions. Auto-created by `OperatorPage` on load if none exists for today.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `church_id` | UUID FK → churches | |
| `title` | TEXT | Editable inline in the operator header |
| `preacher` | TEXT | Optional |
| `sermon_date` | DATE | Default `CURRENT_DATE` |
| `notes` | TEXT | Optional |
| `created_at` | TIMESTAMPTZ | |

### Table: `sermon_verses`

Append-only log of every verse displayed during a sermon. Used by Archive page.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `sermon_id` | UUID FK → sermons | Cascade delete |
| `reference` | TEXT NOT NULL | |
| `book` | TEXT | |
| `chapter` | INT | |
| `verse_start` | INT | |
| `verse_end` | INT | |
| `verse_text` | TEXT | |
| `verses` | JSONB | `[{verseNumber, text}]` |
| `translation_name` | TEXT | |
| `displayed_at` | TIMESTAMPTZ | Default NOW() |

### RLS Policy Summary

| Table | Public Read | Auth Write | Scope |
|-------|------------|------------|-------|
| organizations | No | Yes | Authenticated users; updates org_admin+ only |
| churches | No (authenticated) | Yes | Authenticated users; updates church_admin+ only |
| profiles | No | Own row only | Org members can read each other |
| live_sessions | **Yes** | Yes (auth) | Public read enables congregation/projection without login |
| sermons | No | Yes | Same church members only |
| sermon_verses | No | Yes | Same church members only |

### Trigger: `handle_new_user()`

Fires `AFTER INSERT ON auth.users`. Inserts a `profiles` row with `id = NEW.id` and `full_name` from signup metadata. Runs as `SECURITY DEFINER` so it can write to `public.profiles` from the `auth` schema context.

---

## 7. API Documentation

### 7.1 Anthropic Claude API

**Endpoint:** `POST https://api.anthropic.com/v1/messages`

**Auth:** `x-api-key: {anthropic_key}` header  
**Required header:** `anthropic-dangerous-direct-browser-access: true` (enables direct browser calls without a proxy)

#### Reference Detection Request

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 256,
  "system": "You are a Bible reference detector for live sermon transcription...",
  "messages": [{
    "role": "user",
    "content": "Rolling transcript:\n...\nRecent passages:\n...\nNew chunk:\n\"...\"\n\nReturn JSON: {\"references\":[...]}"
  }]
}
```

**Response shape parsed by `claudeApi.js`:**
```json
{
  "references": [
    {
      "raw": "John three sixteen",
      "book": "John",
      "chapter": 3,
      "verseStart": 16,
      "verseEnd": 16,
      "confidence": 0.95,
      "isPartial": false
    }
  ]
}
```

#### Cross-Reference Request

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 1024,
  "system": "You are a Bible scholar generating cross-references...",
  "messages": [{
    "role": "user",
    "content": "Passage: John 3:16\nText: \"...\"\n\nGenerate 3-5 cross-references. Return JSON: {\"crossReferences\":[...]}"
  }]
}
```

**Response shape:**
```json
{
  "crossReferences": [
    {
      "reference": "Romans 5:8",
      "book": "Romans",
      "chapter": 5,
      "verseStart": 8,
      "verseEnd": 8,
      "tag": "Thematic Echo",
      "reason": "God's love demonstrated through sacrifice."
    }
  ]
}
```

**Error handling:** HTTP 401 = invalid key (surfaced as "Anthropic 401" error). `parseJson()` extracts the first JSON object from the response text, tolerating any surrounding prose.

### 7.2 API.Bible

**Base URL:** `https://api.scripture.api.bible/v1`  
**Auth:** `api-key: {apibible_key}` header  
**Key source:** `scripture.api.bible` (free tier available)

#### List Bibles

```
GET /bibles
```
Used by `loadTranslationList()` on operator mount. Filters for `language.id === 'eng'` and `type === 'text'`. Returns up to 80 English translations merged with `FREE_TRANSLATIONS`.

#### Fetch Passage

```
GET /bibles/{bibleId}/passages/{passageId}?content-type=text&include-verse-numbers=true&...
```

`passageId` format: `JHN.3.16` (single) or `JHN.3.16-JHN.3.18` (range). Book IDs follow USFM standard; the full map is in `BOOK_IDS` in `constants.js`.

Response verse numbers are embedded as `[16]` markers in the plain-text content; `fetchFromApiBible()` parses these with a regex to populate the `verses` array.

### 7.3 bible-api.com (Free)

**Base URL:** `https://bible-api.com`  
**Auth:** None

```
GET /{book}+{chapter}:{verseStart}-{verseEnd}?translation={id}
```

Example: `https://bible-api.com/john+3:16-18?translation=kjv`

Returns `{ verses: [{ book, chapter, verse, text }], text }`. The `verses` array is used directly for multi-verse display; `text` is the fallback for single-verse responses.

**Available translation IDs:** `kjv`, `web`, `asv`, `bbe`, `darby`, `ylt`

### 7.4 Supabase

The app uses the Supabase JS client (`@supabase/supabase-js`). No raw HTTP calls to Supabase REST — all queries go through the client SDK.

Key patterns used:

```js
// Upsert live session (operator pushes verse)
supabase.from('live_sessions').upsert({ church_id, ... }, { onConflict: 'church_id' })

// Safe single-row fetch (returns null instead of throwing on 0 rows)
supabase.from('live_sessions').select('*').eq('church_id', id).maybeSingle()

// Realtime subscription
supabase.channel('projection-{churchId}')
  .on('postgres_changes', { event: 'UPDATE', table: 'live_sessions', filter: `church_id=eq.${id}` }, handler)
  .subscribe()
```

---

## 8. Business Logic

### 8.1 Confidence Threshold System

Detection confidence flows through three routing tiers:

```
0.0 ────────── 0.5 ────────── 0.7 ────────── 1.0
  │  discard   │  ambiguous   │ auto-display  │
              modal          instant
```

Threshold values are constants in `src/lib/constants.js`:
- `CONFIDENCE_THRESHOLD = 0.7` — auto-display threshold
- `0.5` — disambiguation floor (hard-coded in `processChunk`)

Raising `CONFIDENCE_THRESHOLD` reduces false positives but may miss genuine references. Lowering it causes more disambiguation modals.

### 8.2 Chunk Buffering

Two conditions flush the speech buffer to Claude:
1. **Word count** ≥ `CHUNK_WORD_LIMIT` (50) — prevents a single very long sentence from delaying detection
2. **Silence timeout** ≥ `CHUNK_SILENCE_MS` (1500ms) — flushes naturally at pauses in speech

The combination approximates natural sentence boundaries. Increase `CHUNK_WORD_LIMIT` for denser sermons; decrease `CHUNK_SILENCE_MS` for faster detection at the cost of more API calls.

### 8.3 Context Windows

- **Transcript context:** Last 10 minutes of chunks (`TRANSCRIPT_WINDOW_MS`). Enables Claude to resolve pronoun references ("that verse", "as I mentioned earlier").
- **Passage context:** Last 5 verses displayed (`MAX_CONTEXT_PASSAGES`). Sent as `Book Chapter:Verse: "text snippet"` lines. Prevents repeating a verse just displayed.

Reducing these lowers token usage; increasing them improves contextual accuracy for long sermons.

### 8.4 Verse Cache

`bibleApi.js` maintains a module-level `Map` (not localStorage) keyed by `translationId:book:chapter:verseStart:verseEnd`. The cache is cleared on page reload. This means:
- Cross-reference verses that were already displayed in the same session cost zero additional API calls.
- History tab re-displays are instant.
- Cache entries are never invalidated mid-session (Bible text doesn't change).

### 8.5 API Key Resolution Order

For the Anthropic key:
1. `church.anthropic_key` (from Supabase `churches` table) — cloud mode, refreshed on page load
2. `localStorage.getItem('bible_app_anthropic_key')` — set by ⚙ settings panel; persists across reloads
3. Empty string — UI shows the settings panel automatically; voice detection and cross-refs disabled

The same pattern applies to `apibible_key`. Saving a key in the ⚙ panel writes to both localStorage and Supabase (Supabase write is silent-fail safe so local mode still works).

### 8.6 Role Hierarchy

```
super_admin
    └── org_admin      (manages all churches in their org)
            └── church_admin  (manages their church)
                    └── operator   (display only)
```

Role is checked in two places:
- **`AdminPage`:** `useEffect` redirects `operator` and `church_admin` (partial) to `/operator`
- **RLS policies:** `UPDATE` on `organizations` requires `org_admin+`; `UPDATE` on `churches` requires `church_admin+`

### 8.7 Local Mode Data Contract

In local mode, the synthetic `church` object reads from localStorage keys:

| localStorage key | Church field |
|-----------------|-------------|
| `bible_app_church_name` | `name` |
| `bible_app_primary_color` | `primary_color` |
| `bible_app_bg_color` | `bg_color` |
| `bible_app_text_color` | `text_color` |
| `bible_app_anthropic_key` | `anthropic_key` |
| `bible_app_apibible_key` | `apibible_key` |
| `bible_app_local_mode` | mode flag (`"true"`) |

All Supabase writes in local mode silently fail (the tables may not exist), and the app degrades gracefully.

---

## 9. Key Workflows

### 9.1 First-Time Cloud Setup

```
1. User opens /login → clicks "Create account"
2. Supabase sends confirmation email (or disable confirm in Auth settings)
3. User confirms email → signs in
4. handle_new_user() trigger → creates profiles row (church_id = NULL)
5. ProtectedRoute sees profile.church_id == null → redirects to /setup
6. SetupPage wizard:
   a. Enter org name/slug → stored in component state
   b. Enter church name/slug/colour → stored in component state
   c. Enter Anthropic key → validated live against Claude API
   d. On submit: INSERT organizations, INSERT churches, INSERT live_sessions,
      UPDATE profiles SET org_id, church_id, role='org_admin'
   e. refreshProfile() → AuthContext reloads church data from Supabase
7. Navigate to /operator
```

### 9.2 Voice Verse Detection (Happy Path)

```
1. Operator clicks "Listen" → SpeechRecognition starts
2. Preacher says: "Let's look at John chapter three verse sixteen"
3. SpeechRecognition returns final result: "Let's look at John chapter three verse sixteen"
4. Word appended to chunkBufferRef
5. chunkTimerRef fires after 1500ms silence
6. flushChunkBuffer() called → transcriptChunksRef updated
7. processChunk("Let's look at John chapter three verse sixteen") called
8. claudeDetectReferences() → { references: [{ book:'John', chapter:3, verseStart:16, confidence:0.97 }] }
9. confidence >= 0.7 → loadAndDisplayVerse({ book:'John', chapter:3, verseStart:16 })
10. fetchVerseContent() → { text: "For God so loved the world...", verses: [{verseNumber:16, text:"..."}] }
11. setCurrentVerse(verse) → VerseDisplay re-renders
12. pushVerseToSupabase(verse) → live_sessions UPSERT
13. Supabase Realtime broadcasts UPDATE to all subscribers
14. CongregationPage + ProjectionPage receive payload, call show() → fade in verse
15. claudeGenerateCrossRefs() starts (non-blocking)
16. sermon_verses INSERT (non-blocking)
```

### 9.3 Manual Reference Lookup

```
1. Operator types "Romans 8:28-30" in the input bar, presses Enter
2. claudeDetectReferences(key, '', '', "Romans 8:28-30") called
   (empty context strings — manual input needs no context window)
3. Returns { references: [{ book:'Romans', chapter:8, verseStart:28, verseEnd:30, confidence:0.99 }] }
4. loadAndDisplayVerse() → same path as steps 9-16 above
```

### 9.4 Text Selection Verse Display

```
1. Operator highlights "like Romans chapter eight" in the transcript
2. mouseup event fires on the page wrapper
3. window.getSelection().toString() → "like Romans chapter eight"
4. getBoundingClientRect() determines popup coordinates
5. setSelectionPopup({ x, y, text, loading:true })
6. claudeDetectReferences() called with selected text + passage context
7. confidence >= 0.5 → fetchVerseContent()
8. setSelectionPopup({ ...prev, loading:false, verse:{...} })
9. SelectionPopup renders with verse preview + "Display on screen" button
10. Operator clicks "Display on screen" → confirmSelectionVerse(verse)
11. setCurrentVerse, pushVerseToSupabase, cross-refs generation
12. Popup dismisses, selection cleared
```

### 9.5 Projection Window Workflow

```
1. Operator opens /operator (cloud or local mode)
2. ProjectionPreview renders on right side of screen (Projection display mode)
3. Verse is displayed → ProjectionPreview updates instantly from React state
4. Operator adjusts font size A−/A+ (1-5 scale)
5. Operator clicks "↗ Full screen"
6. window.open('/projection/{church.id}?fontSize=3', 'projection', '1920x1080')
7. ProjectionPage loads: fetches church row, fetches current live_session
8. Subscribes to Supabase Realtime for future updates
9. Each new verse fades in (opacity + translateY, 500ms)
10. Clear → is_cleared=true broadcast → fade out, verse set to null
```

---

## 10. Environment Setup

### Prerequisites

- **Node.js** ≥ 18 (for ESM native support)
- **npm** ≥ 9
- **Chrome or Edge** (required for Web Speech API voice recognition)
- **Supabase project** (free tier works) — or skip for local mode
- **Anthropic API key** — required for voice detection and cross-references

### Installation

```bash
git clone https://github.com/tevunaLtd/Bible-app.git
cd Bible-app
npm install
```

### Environment Variables

Create `.env` in the project root (already gitignored):

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

Both values are found in **Supabase Dashboard → Project Settings → API**.

### Apply Database Schema

1. Open **Supabase Dashboard → SQL Editor**
2. Paste the entire contents of `supabase/schema.sql`
3. Click **Run**

This is idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`). Safe to run multiple times.

### Disable Email Confirmation (Recommended for Development)

Supabase requires email confirmation by default. To skip it locally:

1. **Supabase Dashboard → Authentication → Providers → Email**
2. Toggle **"Confirm email"** OFF
3. Save

### Start Dev Server

```bash
npm run dev
```

Vite starts on port 3000 (configured in `vite.config.js`). If 3000 is in use, Vite auto-increments to 3001, 3002, etc.

### First Login

**Option A — Local mode (no Supabase schema needed):**  
Go to `/login` → click **"Use locally — no account"**. Enter your Anthropic key in the ⚙ settings panel that opens automatically.

**Option B — Cloud mode:**  
Sign up at `/login`, confirm email (or disable confirmation as above), complete the setup wizard at `/setup`.

---

## 11. Deployment

### Build

```bash
npm run build
```

Outputs to `dist/`. All assets are hashed for cache-busting. Current bundle: ~462 KB JS / ~23 KB CSS (gzipped: ~131 KB / ~5 KB).

### Hosting Options

**Recommended: Vercel or Netlify (static SPA)**

Vercel:
```bash
npm i -g vercel
vercel --prod
```

Netlify: Connect the GitHub repo in the Netlify dashboard.  
Build command: `npm run build`  
Publish directory: `dist`

**Required: SPA fallback routing**

React Router uses HTML5 history. All routes must serve `index.html`. Configure:

- **Netlify:** Add `public/_redirects`:
  ```
  /* /index.html 200
  ```
- **Vercel:** Add `vercel.json`:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```
- **Nginx:**
  ```nginx
  try_files $uri $uri/ /index.html;
  ```

### Environment Variables in Production

Set the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your hosting platform's environment settings (Vercel: Project Settings → Environment Variables; Netlify: Site Settings → Environment).

Variables prefixed `VITE_` are inlined at build time by Vite — they are **visible in the browser bundle**. The Supabase anon key is designed to be public; security is enforced by RLS policies server-side.

### Production Supabase Checklist

- [ ] Email confirmation enabled (for production user accounts)
- [ ] Schema applied (`supabase/schema.sql`)
- [ ] `live_sessions` added to Realtime publication (included in schema.sql)
- [ ] Allowed origins set in Supabase Dashboard → Auth → URL Configuration (add your production domain)
- [ ] API keys stored in `churches.anthropic_key` / `churches.apibible_key` (not just localStorage)

---

## 12. Known Issues / Limitations

### Voice Recognition

- **Chrome/Edge only.** `SpeechRecognition` is a Chromium API. Firefox and Safari are not supported. The UI shows an error on unsupported browsers.
- **Microphone permission required.** First use prompts the browser permission dialog; denied permission disables listening entirely.
- **Background noise.** Long silences or crosstalk can cause `no-speech` errors, which are silently swallowed (`e.error !== 'no-speech'`).
- **Continuous mode restarts.** The `rec.onend` handler restarts recognition automatically, but some browsers briefly drop audio during the restart gap.

### AI Detection

- **Book name variants.** Claude reliably handles "First Corinthians", "1 Cor", "Psalm 23", "Song of Solomon" etc., but highly abbreviated or colloquial references may be missed.
- **Chapter-only references** (e.g. "Romans 8") are detected but `verseStart` defaults to 1. The operator must manually specify a verse range if needed.
- **API latency.** Claude Haiku typically responds in 300–800ms. Heavy API load may cause detection to lag behind speech. The `processingLockRef` ensures only one detection runs at a time, queuing effectively pauses detection under load.

### Bible APIs

- **bible-api.com rate limits.** The free API is community-maintained with no documented rate limit. Heavy use during a service could cause throttling. API.Bible is the production-grade alternative.
- **Translation availability.** The `BOOK_IDS` map covers all 66 Protestant canon books. Deuterocanonical books (Tobit, Maccabees, etc.) are not in the map; API.Bible calls for these books will throw `Unknown book: Tobit`.
- **Verse cache is in-memory.** Cleared on page reload. If the operator refreshes mid-service, the cache is rebuilt on demand.

### Realtime & Supabase

- **Schema must be applied manually.** Without running `schema.sql`, all Supabase table reads return 404. The app degrades to local mode only.
- **One live_session per church.** The `UNIQUE` constraint on `church_id` in `live_sessions` means only one operator can push at a time. Concurrent pushes from two operator tabs will succeed (both upsert) but will overwrite each other.
- **Realtime latency.** Supabase Realtime typically delivers events in < 200ms but can spike under load. This is not a hard real-time system.

### Local Mode

- **No congregation sync.** Congregation (`/c/:slug`) and projection (`/projection/:id`) pages use Supabase Realtime. In local mode, the projection preview updates locally but the full-screen window will not receive updates (it subscribes to Supabase, not local state).
- **No persistence.** Session history and sermon archive are in-memory only; cleared on page reload.

---

## 13. Future Improvements / Roadmap

### High Priority

- **WebSocket proxy for Claude.** Current direct-browser Claude calls require `anthropic-dangerous-direct-browser-access: true` and expose the API key in browser devtools. A thin Edge Function or server proxy would hide the key and enable token counting / rate limiting.
- **Deuterocanonical book support.** Extend `BOOK_IDS` to cover Catholic/Orthodox canon books.
- **Offline / PWA mode.** Cache the top 50 most-used verses in IndexedDB via a Service Worker. Survive internet loss mid-service.

### Medium Priority

- **Verse queue.** Let the operator queue upcoming verses during the sermon without displaying them immediately. One-click to advance to the next queued verse.
- **Slide templates.** Alternative projection layouts: text-only, image background, lower-third bar (for broadcast).
- **QR code display.** Show the congregation URL as a QR code on the projection screen at service start.
- **Preacher mode.** A simplified phone UI for the preacher to swipe through recently detected verses.
- **Multi-language detection.** Extend the Claude prompt to detect references in Spanish, French, Swahili, etc.

### Lower Priority

- **Verse analytics.** Track which scriptures are used most across sermons; visualise themes over time.
- **Supabase Edge Functions.** Move Claude calls to Deno Edge Functions to centralise key management and add proper error logging.
- **Native desktop app.** Electron wrapper for churches that need a dedicated kiosk device with reliable audio access.
- **MIDI / NDI integration.** Trigger verse display from MIDI foot pedals or push verses to NDI video feeds for live broadcast.
- **Bulk import sermons.** Upload a sermon outline or `.docx` and pre-populate the verse queue.

---

## 14. Contribution Guidelines

### Branch Strategy

```
main        — production-ready code; deploys automatically on push
develop     — integration branch; PRs merge here first
feature/*   — individual features (e.g. feature/verse-queue)
fix/*       — bug fixes
```

### Commit Style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add verse queue with preacher controls
fix: prevent double detection when processingLock races
chore: bump supabase-js to 2.106
docs: update schema.sql comments
```

### Pull Request Requirements

1. PR description must explain *why*, not just *what*
2. No new environment variables without updating section 10 of this README
3. Any change to `constants.js` thresholds must include a comment explaining the trade-off
4. Supabase schema changes must update both `schema.sql` and section 6 of this README
5. All Claude prompts live in `claudeApi.js` — do not embed prompt strings in components

### Adding a New Translation Source

1. Add a fetch function in `bibleApi.js` following the `{ text, verses }` return shape
2. Add translation entries to `FREE_TRANSLATIONS` or handle them in `loadTranslationList()`
3. Ensure `fetchVerseContent()` routes to the new source via the `translation.source` field
4. If the source requires a new API key, add it to the `churches` table schema and `localChurch()` in `AuthContext`

### Adding a New Page/Route

1. Create `src/pages/NewPage.jsx`
2. Add the import and `<Route>` in `App.jsx`
3. Wrap in `<ProtectedRoute>` if auth is required
4. If the route needs church/org context, consume `useAuth()` — do not fetch from Supabase directly in the component; load via the auth context pattern

### Local Development with Supabase

For schema changes, use the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase init
supabase db diff --schema public   # compare local vs remote
supabase db push                   # push migrations
```

Keep `supabase/schema.sql` as the canonical single-file schema for engineers who don't use the CLI.

### Code Style

- **No TypeScript** — the project is intentionally plain JavaScript for accessibility
- **Tailwind only** — no CSS modules or styled-components
- **No default exports from `lib/`** — all lib functions are named exports
- **No inline comments explaining *what* the code does** — only *why* (non-obvious constraints, API quirks, workarounds)
- Max ~700 lines per file; split into sub-components if exceeded
- Run `npm run build` before raising a PR to catch Vite/Rollup errors

---

*Last updated: May 2026*
