/**
 * SetupPage — first-run wizard shown when a logged-in user has no church assigned.
 *
 * Steps:
 *   1. Create organization (name, slug)
 *   2. Create church (name, slug, API keys, accent colour)
 *   3. Update profile with org_id + church_id + role = org_admin
 *
 * After completion, refreshProfile() in AuthContext re-loads the profile
 * and App.jsx routes to /operator.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { DETECT_MODEL, ANTHROPIC_API } from '../lib/constants';

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function SetupPage() {
  const { session, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1); // 1 = org, 2 = church, 3 = keys

  // Step 1
  const [orgName,  setOrgName]  = useState('');
  const [orgSlug,  setOrgSlug]  = useState('');

  // Step 2
  const [churchName,  setChurchName]  = useState('');
  const [churchSlug,  setChurchSlug]  = useState('');
  const [primaryColor, setPrimaryColor] = useState('#d4af37');

  // Step 3
  const [anthropicKey, setAnthropicKey] = useState('');
  const [apiBibleKey,  setApiBibleKey]  = useState('');

  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  // ── Validate Anthropic key ────────────────────────────────
  async function validateAnthropicKey(key) {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: DETECT_MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }),
    });
    if (res.status === 401) throw new Error('Invalid Anthropic API key.');
  }

  // ── Final submit ──────────────────────────────────────────
  async function handleFinish(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await validateAnthropicKey(anthropicKey.trim());

      // 1. Insert org
      const { data: org, error: orgErr } = await supabase
        .from('organizations')
        .insert({ name: orgName.trim(), slug: orgSlug.trim() })
        .select()
        .single();
      if (orgErr) throw orgErr;

      // 2. Insert church
      const { data: church, error: chErr } = await supabase
        .from('churches')
        .insert({
          org_id:        org.id,
          name:          churchName.trim(),
          slug:          churchSlug.trim(),
          primary_color: primaryColor,
          anthropic_key: anthropicKey.trim(),
          apibible_key:  apiBibleKey.trim() || null,
        })
        .select()
        .single();
      if (chErr) throw chErr;

      // 3. Create live_session row for this church
      await supabase.from('live_sessions').insert({ church_id: church.id });

      // 4. Update profile
      const { error: profErr } = await supabase
        .from('profiles')
        .update({ org_id: org.id, church_id: church.id, role: 'org_admin' })
        .eq('id', session.user.id);
      if (profErr) throw profErr;

      await refreshProfile();
      navigate('/operator', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const inputCls = 'w-full bg-[#0d1b2a] border border-[#243444] rounded-lg px-4 py-3 text-[#f5ead6] font-sans text-sm placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37] transition-colors';
  const labelCls = 'block text-[#c8b89a] font-sans text-sm mb-1.5';

  return (
    <div className="min-h-screen bg-[#0d1b2a] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3 select-none">✝</div>
          <h1 className="text-2xl font-serif text-[#f5ead6] mb-1">Welcome — let's set things up</h1>
          <p className="text-[#5a6a7a] font-sans text-sm">Step {step} of 3</p>
        </div>

        {/* Step progress */}
        <div className="flex gap-2 mb-8">
          {[1,2,3].map(s => (
            <div key={s} className={`flex-1 h-1 rounded-full transition-colors ${s <= step ? 'bg-[#d4af37]' : 'bg-[#1e3050]'}`} />
          ))}
        </div>

        <form onSubmit={step < 3 ? (e) => { e.preventDefault(); setStep(s => s + 1); } : handleFinish}
          className="bg-[#1a2a3a] rounded-2xl p-8 shadow-2xl border border-[#243444] space-y-5">

          {/* Step 1: Organisation */}
          {step === 1 && (
            <>
              <h2 className="text-[#d4af37] font-sans font-semibold text-base">Your organisation</h2>
              <div>
                <label className={labelCls}>Organisation name <span className="text-red-400">*</span></label>
                <input value={orgName} onChange={e => { setOrgName(e.target.value); setOrgSlug(slugify(e.target.value)); }}
                  required placeholder="e.g. Tevuna Ltd" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>URL slug <span className="text-red-400">*</span></label>
                <input value={orgSlug} onChange={e => setOrgSlug(slugify(e.target.value))}
                  required placeholder="tevuna-ltd" className={inputCls} />
                <p className="text-[#4a5a6a] font-sans text-xs mt-1">Used in URLs — lowercase letters, numbers and hyphens only.</p>
              </div>
            </>
          )}

          {/* Step 2: Church */}
          {step === 2 && (
            <>
              <h2 className="text-[#d4af37] font-sans font-semibold text-base">First church</h2>
              <div>
                <label className={labelCls}>Church name <span className="text-red-400">*</span></label>
                <input value={churchName} onChange={e => { setChurchName(e.target.value); setChurchSlug(slugify(e.target.value)); }}
                  required placeholder="e.g. Grace Chapel" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Congregation URL slug <span className="text-red-400">*</span></label>
                <input value={churchSlug} onChange={e => setChurchSlug(slugify(e.target.value))}
                  required placeholder="grace-chapel" className={inputCls} />
                <p className="text-[#4a5a6a] font-sans text-xs mt-1">
                  Members open <span className="text-[#8a9aaa]">/c/{churchSlug || 'your-slug'}</span> on their phones to follow along.
                </p>
              </div>
              <div>
                <label className={labelCls}>Accent colour</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                    className="w-12 h-10 rounded cursor-pointer bg-transparent border-0" />
                  <input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                    className={`${inputCls} flex-1`} placeholder="#d4af37" />
                </div>
              </div>
            </>
          )}

          {/* Step 3: API keys */}
          {step === 3 && (
            <>
              <h2 className="text-[#d4af37] font-sans font-semibold text-base">API keys</h2>
              <div>
                <label className={labelCls}>Anthropic API key <span className="text-red-400">*</span></label>
                <input type="password" value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)}
                  required placeholder="sk-ant-…" autoComplete="off" className={inputCls} />
                <p className="text-[#4a5a6a] font-sans text-xs mt-1">
                  Required — powers reference detection and cross-references. console.anthropic.com
                </p>
              </div>
              <div>
                <label className={labelCls}>API.Bible key <span className="text-[#4a5a6a] font-normal">(optional)</span></label>
                <input type="password" value={apiBibleKey} onChange={e => setApiBibleKey(e.target.value)}
                  placeholder="Your API.Bible key" autoComplete="off" className={inputCls} />
                <p className="text-[#4a5a6a] font-sans text-xs mt-1">
                  Unlocks NIV, NKJV, ESV and 80+ more translations. scripture.api.bible
                </p>
              </div>
            </>
          )}

          {error && (
            <div className="bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-red-300 font-sans text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            {step > 1 && (
              <button type="button" onClick={() => setStep(s => s - 1)}
                className="flex-1 border border-[#243444] text-[#6a7a8a] hover:text-[#c8b89a] font-sans font-semibold py-3 rounded-lg transition-colors text-sm">
                Back
              </button>
            )}
            <button type="submit" disabled={loading}
              className="flex-1 bg-[#d4af37] hover:bg-[#c4a030] disabled:bg-[#5a4a1a] disabled:cursor-not-allowed text-[#0d1b2a] font-sans font-semibold py-3 rounded-lg transition-colors text-sm">
              {loading ? 'Setting up…' : step < 3 ? 'Next' : 'Finish setup'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
