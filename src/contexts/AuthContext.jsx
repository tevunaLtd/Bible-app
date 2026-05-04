/**
 * AuthContext — provides session, profile, and church to all components.
 *
 * Consumers:
 *   const { session, profile, church, loading, signOut } = useAuth();
 *
 * States:
 *   loading    — true while Supabase resolves the initial session
 *   session    — Supabase session (null if not logged in)
 *   profile    — row from public.profiles (null if not logged in)
 *   church     — row from public.churches (null if profile has no church_id)
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [church,  setChurch]  = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    setProfile(data ?? null);

    if (data?.church_id) {
      const { data: ch } = await supabase
        .from('churches')
        .select('*')
        .eq('id', data.church_id)
        .single();
      setChurch(ch ?? null);
    } else {
      setChurch(null);
    }
  }

  useEffect(() => {
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
    await supabase.auth.signOut();
  }

  // Called after setup completes to re-load the freshly created profile
  async function refreshProfile() {
    if (session?.user?.id) await loadProfile(session.user.id);
  }

  return (
    <AuthContext.Provider value={{ session, profile, church, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
