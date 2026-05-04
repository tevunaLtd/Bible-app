-- ═══════════════════════════════════════════════════════════
-- Bible Display — Supabase Schema
-- Run this entire file in the Supabase SQL Editor (once).
-- ═══════════════════════════════════════════════════════════

-- ── Tables ──────────────────────────────────────────────────

-- Top-level white-label entity (e.g. "Tevuna Ltd")
CREATE TABLE IF NOT EXISTS public.organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  logo_url      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Individual churches that belong to an organization
CREATE TABLE IF NOT EXISTS public.churches (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name                 TEXT NOT NULL,
  slug                 TEXT UNIQUE NOT NULL,       -- used in congregation URL: /c/:slug
  logo_url             TEXT,
  primary_color        TEXT DEFAULT '#d4af37',     -- gold accent
  bg_color             TEXT DEFAULT '#0d1b2a',     -- dark background
  text_color           TEXT DEFAULT '#f5ead6',     -- warm white text
  default_translation  TEXT DEFAULT 'kjv',
  anthropic_key        TEXT,                       -- stored with RLS; only church members can read
  apibible_key         TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Extends auth.users — created automatically by trigger on signup
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      UUID REFERENCES public.organizations(id),
  church_id   UUID REFERENCES public.churches(id),
  role        TEXT NOT NULL DEFAULT 'operator'
                CHECK (role IN ('super_admin','org_admin','church_admin','operator')),
  full_name   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- One row per church — holds the currently displayed verse for real-time sync
CREATE TABLE IF NOT EXISTS public.live_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id        UUID REFERENCES public.churches(id) ON DELETE CASCADE UNIQUE NOT NULL,
  verse_text       TEXT,
  verse_reference  TEXT,
  translation_name TEXT,
  verses           JSONB DEFAULT '[]'::jsonb,   -- [{verseNumber, text}]
  is_cleared       BOOLEAN DEFAULT FALSE,
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- A named sermon session
CREATE TABLE IF NOT EXISTS public.sermons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id    UUID REFERENCES public.churches(id) ON DELETE CASCADE NOT NULL,
  title        TEXT NOT NULL DEFAULT 'Untitled Sermon',
  preacher     TEXT,
  sermon_date  DATE DEFAULT CURRENT_DATE,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Every verse displayed during a sermon
CREATE TABLE IF NOT EXISTS public.sermon_verses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sermon_id        UUID REFERENCES public.sermons(id) ON DELETE CASCADE NOT NULL,
  reference        TEXT NOT NULL,
  book             TEXT,
  chapter          INT,
  verse_start      INT,
  verse_end        INT,
  verse_text       TEXT,
  verses           JSONB DEFAULT '[]'::jsonb,
  translation_name TEXT,
  displayed_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Trigger: auto-create profile on signup ───────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Row Level Security ───────────────────────────────────────

ALTER TABLE public.organizations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.churches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sermons        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sermon_verses  ENABLE ROW LEVEL SECURITY;

-- profiles: read/write own row; org members can read each other
CREATE POLICY "profiles_self"     ON public.profiles FOR ALL   USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_org_read" ON public.profiles FOR SELECT USING (
  org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
);

-- organizations: any authenticated user can create (for first-run setup);
-- only org admins can update/delete
CREATE POLICY "orgs_read"   ON public.organizations FOR SELECT TO authenticated USING (true);
CREATE POLICY "orgs_insert" ON public.organizations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "orgs_update" ON public.organizations FOR UPDATE USING (
  id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin','org_admin'))
);
CREATE POLICY "orgs_delete" ON public.organizations FOR DELETE USING (
  id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin','org_admin'))
);

-- churches: readable by authenticated users in the same org; writable by org admins
CREATE POLICY "churches_read"   ON public.churches FOR SELECT TO authenticated USING (true);
CREATE POLICY "churches_insert" ON public.churches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "churches_update" ON public.churches FOR UPDATE USING (
  org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin','org_admin','church_admin'))
);
CREATE POLICY "churches_delete" ON public.churches FOR DELETE USING (
  org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin','org_admin'))
);

-- live_sessions: public read (congregation + projection need no login); authenticated write
CREATE POLICY "live_public_read" ON public.live_sessions FOR SELECT USING (true);
CREATE POLICY "live_write"       ON public.live_sessions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- sermons: church members only
CREATE POLICY "sermons_read"   ON public.sermons FOR SELECT TO authenticated USING (
  church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid())
);
CREATE POLICY "sermons_insert" ON public.sermons FOR INSERT TO authenticated WITH CHECK (
  church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid())
);
CREATE POLICY "sermons_update" ON public.sermons FOR UPDATE USING (
  church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid())
);
CREATE POLICY "sermons_delete" ON public.sermons FOR DELETE USING (
  church_id IN (SELECT church_id FROM public.profiles WHERE id = auth.uid()
    AND role IN ('church_admin','org_admin','super_admin'))
);

-- sermon_verses: same church members
CREATE POLICY "sermon_verses_read"   ON public.sermon_verses FOR SELECT TO authenticated USING (
  sermon_id IN (SELECT id FROM public.sermons WHERE church_id IN (
    SELECT church_id FROM public.profiles WHERE id = auth.uid()))
);
CREATE POLICY "sermon_verses_insert" ON public.sermon_verses FOR INSERT TO authenticated WITH CHECK (
  sermon_id IN (SELECT id FROM public.sermons WHERE church_id IN (
    SELECT church_id FROM public.profiles WHERE id = auth.uid()))
);

-- ── Enable realtime on live_sessions ────────────────────────
-- In Supabase Dashboard → Database → Replication, also enable live_sessions.
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions;
