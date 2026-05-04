/**
 * LoginPage — email/password login and signup via Supabase Auth.
 * After login, AuthContext resolves the session and App routes to /operator.
 * New users are routed to /setup automatically (no church_id on their profile yet).
 */

import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function LoginPage() {
  const [mode,     setMode]     = useState('login'); // 'login' | 'signup'
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // AuthContext picks up the session — App.jsx will redirect
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name } },
        });
        if (error) throw error;
        setDone(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0d1b2a] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="text-5xl mb-4 select-none">✝</div>
          <h1 className="text-3xl font-serif text-[#f5ead6] mb-1">Bible Display</h1>
          <p className="text-[#6a7a8a] text-sm font-sans">Voice-powered sermon scripture display</p>
        </div>

        {done ? (
          <div className="bg-[#1a2a3a] rounded-2xl p-8 border border-[#243444] text-center">
            <p className="text-green-400 font-sans mb-2 font-semibold">Check your email</p>
            <p className="text-[#8a8a8a] font-sans text-sm">
              We sent a confirmation link to <span className="text-[#c8b89a]">{email}</span>.
              Click it to activate your account, then log in.
            </p>
            <button onClick={() => { setMode('login'); setDone(false); }}
              className="mt-6 text-[#d4af37] font-sans text-sm hover:underline">
              Back to login
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-[#1a2a3a] rounded-2xl p-8 shadow-2xl border border-[#243444]">
            <div className="flex gap-0 mb-6 bg-[#0d1b2a] rounded-lg p-0.5">
              {['login','signup'].map(m => (
                <button key={m} type="button" onClick={() => { setMode(m); setError(''); }}
                  className={`flex-1 py-2 rounded-md font-sans text-sm font-medium transition-colors ${mode === m ? 'bg-[#d4af37] text-[#0d1b2a]' : 'text-[#6a7a8a] hover:text-[#c8b89a]'}`}>
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
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="w-full bg-[#0d1b2a] border border-[#243444] rounded-lg px-4 py-3 text-[#f5ead6] font-sans text-sm placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37]" />
            </div>

            {error && (
              <div className="mb-4 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-red-300 font-sans text-sm">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-[#d4af37] hover:bg-[#c4a030] disabled:bg-[#5a4a1a] disabled:cursor-not-allowed text-[#0d1b2a] font-sans font-semibold py-3 rounded-lg transition-colors text-sm">
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
