/**
 * LoginPage — email/password login + signup via Supabase Auth.
 * Also offers "Use locally" to skip auth entirely (local mode).
 */

import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function LoginPage() {
  const [mode,     setMode]     = useState('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false);

  // Friendly rewrites for common Supabase error messages
  function friendlyError(msg = '') {
    if (msg.toLowerCase().includes('invalid login credentials'))
      return 'Email or password is incorrect. If you just signed up, check your inbox for a confirmation link first.';
    if (msg.toLowerCase().includes('email not confirmed'))
      return 'Please confirm your email before logging in — check your inbox for the confirmation link.';
    if (msg.toLowerCase().includes('user already registered'))
      return 'An account with this email already exists. Use "Sign in" instead.';
    return msg;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name } },
        });
        if (error) throw error;
        setDone(true);
      }
    } catch (err) {
      setError(friendlyError(err.message));
    } finally {
      setLoading(false);
    }
  }

  function useLocally() {
    localStorage.setItem('bible_app_local_mode', 'true');
    window.location.href = '/operator';
  }

  const gold = '#d4af37';

  return (
    <div className="min-h-screen bg-[#0d1b2a] flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-4 select-none" style={{ color: gold }}>✝</div>
          <h1 className="text-3xl font-serif text-[#f5ead6] mb-1">Bible Display</h1>
          <p className="text-[#6a7a8a] text-sm font-sans">Voice-powered sermon scripture display</p>
        </div>

        {done ? (
          <div className="bg-[#1a2a3a] rounded-2xl p-8 border border-[#243444] text-center">
            <p className="text-green-400 font-sans mb-2 font-semibold">Check your email</p>
            <p className="text-[#8a8a8a] font-sans text-sm">
              We sent a confirmation link to <span className="text-[#c8b89a]">{email}</span>.
              Click it to activate your account, then sign in below.
            </p>
            <button onClick={() => { setMode('login'); setDone(false); }}
              className="mt-6 font-sans text-sm hover:underline" style={{ color: gold }}>
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-[#1a2a3a] rounded-2xl p-8 shadow-2xl border border-[#243444]">
            {/* Mode toggle */}
            <div className="flex gap-0 mb-6 bg-[#0d1b2a] rounded-lg p-0.5">
              {['login','signup'].map(m => (
                <button key={m} type="button" onClick={() => { setMode(m); setError(''); }}
                  className={`flex-1 py-2 rounded-md font-sans text-sm font-medium transition-colors ${mode === m ? 'text-[#0d1b2a] font-semibold' : 'text-[#6a7a8a] hover:text-[#c8b89a]'}`}
                  style={mode === m ? { background: gold } : {}}>
                  {m === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            {mode === 'signup' && (
              <div className="mb-4">
                <label className="block text-[#c8b89a] font-sans text-sm mb-1.5">Full name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} required
                  className="w-full bg-[#0d1b2a] border border-[#243444] rounded-lg px-4 py-3 text-[#f5ead6] font-sans text-sm placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37]" />
              </div>
            )}

            <div className="mb-4">
              <label className="block text-[#c8b89a] font-sans text-sm mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email"
                className="w-full bg-[#0d1b2a] border border-[#243444] rounded-lg px-4 py-3 text-[#f5ead6] font-sans text-sm placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37]" />
            </div>

            <div className="mb-6">
              <label className="block text-[#c8b89a] font-sans text-sm mb-1.5">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="w-full bg-[#0d1b2a] border border-[#243444] rounded-lg px-4 py-3 text-[#f5ead6] font-sans text-sm placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37]" />
            </div>

            {error && (
              <div className="mb-4 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-red-300 font-sans text-sm">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full font-sans font-semibold py-3 rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: gold, color: '#0d1b2a' }}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        )}

        {/* ── Local mode ─────────────────────────────────────────────── */}
        <div className="bg-[#0d1b2a] border border-[#1e3050] rounded-2xl p-5 text-center">
          <p className="text-[#5a6a7a] font-sans text-xs uppercase tracking-wider mb-1">No account needed</p>
          <p className="text-[#8a9aaa] font-sans text-sm mb-4">
            Use the app locally on this device — no sign-in required.
            Multi-device sync and congregation view require an account.
          </p>
          <button onClick={useLocally}
            className="w-full border font-sans font-semibold text-sm py-2.5 rounded-xl transition-colors hover:bg-[#1a2a3a]"
            style={{ borderColor: gold + '50', color: gold }}>
            Use locally — no account
          </button>
        </div>

      </div>
    </div>
  );
}
