/**
 * AuthContext — provides session, profile, and church to all components.
 *
 * Two modes:
 *   • Local mode  (localStorage key "bible_app_local_mode" = "true")
 *     — no Supabase auth needed; church settings live in localStorage
 *   • Cloud mode  — full Supabase auth + profiles/churches tables
 *
 * Consumers: const { session, profile, church, loading, signOut, isLocalMode } = useAuth();
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

// ── Helpers for local mode ────────────────────────────────────────────────────
function localChurch() {
  return {
    id:            'local',
    name:          localStorage.getItem('bible_app_church_name')  || 'My Church',
    slug:          'local',
    primary_color: localStorage.getItem('bible_app_primary_color') || '#d4af37',
    bg_color:      localStorage.getItem('bible_app_bg_color')      || '#0d1b2a',
    text_color:    localStorage.getItem('bible_app_text_color')    || '#f5ead6',
    anthropic_key: localStorage.getItem('bible_app_anthropic_key') || '',
    apibible_key:  localStorage.getItem('bible_app_apibible_key')  || '',
    logo_url:      null,
  };
}

const LOCAL_SESSION = { user: { id: 'local', email: 'local@local.app' } };
const LOCAL_PROFILE = { id: 'local', full_name: 'Operator', role: 'operator', church_id: 'local' };

// ─────────────────────────────────────────────────────────────────────────────

export function AuthProvider({ children }) {
  const isLocalMode = localStorage.getItem('bible_app_local_mode') === 'true';

  const [session, setSession] = useState(isLocalMode ? LOCAL_SESSION : null);
  const [profile, setProfile] = useState(isLocalMode ? LOCAL_PROFILE : null);
  const [church,  setChurch]  = useState(isLocalMode ? localChurch() : null);
  const [loading, setLoading] = useState(!isLocalMode);

  async function loadProfile(userId) {
    const { data } = await supabase
      .from('profiles').select('*').eq('id', userId).maybeSingle();
    setProfile(data ?? null);

    if (data?.church_id) {
      const { data: ch } = await supabase
        .from('churches').select('*').eq('id', data.church_id).maybeSingle();
      setChurch(ch ?? null);
    } else {
      setChurch(null);
    }
  }

  useEffect(() => {
    if (isLocalMode) return; // skip Supabase in local mode

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else { setProfile(null); setChurch(null); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    if (isLocalMode) {
      localStorage.removeItem('bible_app_local_mode');
      window.location.href = '/login';
      return;
    }
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (isLocalMode) { setChurch(localChurch()); return; }
    if (session?.user?.id) await loadProfile(session.user.id);
  }

  return (
    <AuthContext.Provider value={{ session, profile, church, loading, signOut, refreshProfile, isLocalMode }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
