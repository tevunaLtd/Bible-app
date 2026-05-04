/**
 * AdminPage — manage churches, operators, and white-label settings.
 *
 * Tabs:
 *   Churches   — create, edit (name, slug, colours, API keys, logo)
 *   Operators  — list users in this org; assign to church; change role
 *   Settings   — org-level settings (org name, logo)
 *
 * Access:  org_admin and super_admin only (other roles see /operator).
 */

import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Shared input style ────────────────────────────────────────
const INP = 'w-full bg-[#0d1b2a] border border-[#243444] rounded-lg px-3 py-2.5 text-[#f5ead6] font-sans text-sm placeholder-[#3a4a5a] focus:outline-none focus:border-[#d4af37]';
const LBL = 'block text-[#c8b89a] font-sans text-xs mb-1';

// ── Church form (create / edit) ───────────────────────────────
function ChurchForm({ org, initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    name: '', slug: '', primary_color: '#d4af37', bg_color: '#0d1b2a', text_color: '#f5ead6',
    logo_url: '', default_translation: 'kjv', anthropic_key: '', apibible_key: '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave(e) {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      if (initial?.id) {
        // Update existing church
        const { error } = await supabase.from('churches').update({ ...form }).eq('id', initial.id);
        if (error) throw error;
      } else {
        // Create new church + live_session row
        const { data: ch, error } = await supabase
          .from('churches')
          .insert({ ...form, org_id: org.id })
          .select().single();
        if (error) throw error;
        await supabase.from('live_sessions').insert({ church_id: ch.id });
      }
      onSave();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSave} className="bg-[#1a2a3a] border border-[#243444] rounded-2xl p-6 space-y-4">
      <h3 className="text-[#d4af37] font-sans font-semibold text-sm">{initial?.id ? 'Edit church' : 'New church'}</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={LBL}>Church name *</label>
          <input value={form.name} onChange={e => { set('name', e.target.value); if (!initial?.id) set('slug', slugify(e.target.value)); }}
            required className={INP} />
        </div>
        <div>
          <label className={LBL}>URL slug *</label>
          <input value={form.slug} onChange={e => set('slug', slugify(e.target.value))} required className={INP} />
          <p className="text-[#3a4a5a] font-sans text-xs mt-0.5">/c/{form.slug || 'your-slug'}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[['primary_color','Accent'],['bg_color','Background'],['text_color','Text']].map(([k, label]) => (
          <div key={k}>
            <label className={LBL}>{label} colour</label>
            <div className="flex items-center gap-2">
              <input type="color" value={form[k]} onChange={e => set(k, e.target.value)} className="w-9 h-9 rounded cursor-pointer bg-transparent border-0 shrink-0" />
              <input value={form[k]} onChange={e => set(k, e.target.value)} className={`${INP} flex-1 min-w-0`} />
            </div>
          </div>
        ))}
      </div>

      <div>
        <label className={LBL}>Logo URL (optional)</label>
        <input value={form.logo_url} onChange={e => set('logo_url', e.target.value)} placeholder="https://…" className={INP} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={LBL}>Anthropic API key *</label>
          <input type="password" value={form.anthropic_key} onChange={e => set('anthropic_key', e.target.value)} required={!initial?.id} className={INP} placeholder={initial?.id ? '(unchanged)' : 'sk-ant-…'} autoComplete="off" />
        </div>
        <div>
          <label className={LBL}>API.Bible key (optional)</label>
          <input type="password" value={form.apibible_key} onChange={e => set('apibible_key', e.target.value)} className={INP} placeholder="optional" autoComplete="off" />
        </div>
      </div>

      {error && <p className="text-red-400 font-sans text-sm">{error}</p>}

      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 border border-[#243444] text-[#6a7a8a] hover:text-[#c8b89a] font-sans py-2 rounded-lg text-sm transition-colors">Cancel</button>
        <button type="submit" disabled={saving} className="flex-1 bg-[#d4af37] hover:bg-[#c4a030] disabled:opacity-50 text-[#0d1b2a] font-sans font-semibold py-2 rounded-lg text-sm transition-colors">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

// ── Main AdminPage ────────────────────────────────────────────
export default function AdminPage() {
  const { profile, church: myChurch, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [tab,      setTab]      = useState('churches');
  const [churches, setChurches] = useState([]);
  const [users,    setUsers]    = useState([]);
  const [org,      setOrg]      = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(null);  // church being edited (or 'new')
  const [orgName,  setOrgName]  = useState('');
  const [orgSaving,setOrgSaving]= useState(false);

  // Redirect operators away from admin
  useEffect(() => {
    if (profile && !['org_admin','super_admin','church_admin'].includes(profile.role)) {
      navigate('/operator', { replace: true });
    }
  }, [profile]);

  async function load() {
    if (!profile?.org_id) return;
    const [{ data: org }, { data: chs }, { data: usrs }] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', profile.org_id).single(),
      supabase.from('churches').select('*').eq('org_id', profile.org_id).order('created_at'),
      supabase.from('profiles').select('*').eq('org_id', profile.org_id).order('created_at'),
    ]);
    setOrg(org); setOrgName(org?.name || '');
    setChurches(chs || []);
    setUsers(usrs || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [profile?.org_id]);

  async function saveOrgName(e) {
    e.preventDefault();
    setOrgSaving(true);
    await supabase.from('organizations').update({ name: orgName }).eq('id', org.id);
    setOrgSaving(false);
    load();
  }

  async function assignChurch(userId, churchId) {
    await supabase.from('profiles').update({ church_id: churchId || null }).eq('id', userId);
    if (userId === profile.id) await refreshProfile();
    load();
  }

  async function changeRole(userId, role) {
    await supabase.from('profiles').update({ role }).eq('id', userId);
    load();
  }

  async function deleteChurch(id) {
    if (!window.confirm('Delete this church and all its data?')) return;
    await supabase.from('churches').delete().eq('id', id);
    load();
  }

  const SEL = 'bg-[#0d1b2a] border border-[#243444] text-[#c8b89a] font-sans text-xs rounded-lg px-2 py-1.5 focus:outline-none';

  if (loading) return (
    <div className="min-h-screen bg-[#0d1b2a] flex items-center justify-center">
      <span className="text-[#d4af37] font-serif text-xl animate-pulse">Loading…</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a1520] text-[#f5ead6]">
      {/* Header */}
      <header className="bg-[#0d1b2a] border-b border-[#1e3050] px-6 py-3 flex items-center gap-4">
        <span className="text-[#d4af37] text-xl select-none">✝</span>
        <h1 className="font-serif text-[#f5ead6] text-lg">Admin Dashboard</h1>
        <span className="text-[#5a6a7a] font-sans text-sm">{org?.name}</span>
        <div className="ml-auto flex items-center gap-4">
          <Link to="/operator" className="text-[#6a7a8a] hover:text-[#c8b89a] font-sans text-sm transition-colors">← Operator</Link>
          <Link to="/archive"  className="text-[#6a7a8a] hover:text-[#c8b89a] font-sans text-sm transition-colors">Archive</Link>
          <button onClick={signOut} className="text-[#6a7a8a] hover:text-red-400 font-sans text-sm transition-colors">Sign out</button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-[#0d1b2a] rounded-xl p-1 w-fit border border-[#1e3050]">
          {['churches','operators','settings'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-lg font-sans text-sm font-medium transition-colors capitalize ${tab === t ? 'bg-[#d4af37] text-[#0d1b2a]' : 'text-[#6a7a8a] hover:text-[#c8b89a]'}`}>
              {t}
            </button>
          ))}
        </div>

        {/* ── Churches tab ───────────────────────────────────────── */}
        {tab === 'churches' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[#c8b89a] font-sans font-semibold">{churches.length} Church{churches.length !== 1 ? 'es' : ''}</h2>
              <button onClick={() => setEditing('new')}
                className="bg-[#d4af37] hover:bg-[#c4a030] text-[#0d1b2a] font-sans font-semibold px-4 py-2 rounded-lg text-sm transition-colors">
                + Add church
              </button>
            </div>

            {editing === 'new' && (
              <ChurchForm org={org} onSave={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
            )}

            {churches.map(ch => (
              <div key={ch.id}>
                {editing?.id === ch.id ? (
                  <ChurchForm org={org} initial={ch} onSave={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
                ) : (
                  <div className="bg-[#0d1b2a] border border-[#1e3050] rounded-xl p-5 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: ch.primary_color || '#d4af37' }}>
                        <span className="text-white text-lg font-serif">{ch.name[0]}</span>
                      </div>
                      <div>
                        <p className="text-[#f5ead6] font-sans font-semibold">{ch.name}</p>
                        <p className="text-[#5a6a7a] font-sans text-xs">/c/{ch.slug}</p>
                        <div className="flex gap-2 mt-2">
                          <a href={`/c/${ch.slug}`} target="_blank" rel="noreferrer"
                            className="text-[#d4af37] font-sans text-xs hover:underline">Congregation link ↗</a>
                          <span className="text-[#2a3a4a]">·</span>
                          <span className="text-[#3a4a5a] font-sans text-xs">
                            {users.filter(u => u.church_id === ch.id).length} operator(s)
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => setEditing(ch)} className="border border-[#243444] text-[#6a7a8a] hover:text-[#c8b89a] font-sans text-xs px-3 py-1.5 rounded-lg transition-colors">Edit</button>
                      <button onClick={() => deleteChurch(ch.id)} className="border border-red-900 text-red-700 hover:text-red-400 font-sans text-xs px-3 py-1.5 rounded-lg transition-colors">Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Operators tab ──────────────────────────────────────── */}
        {tab === 'operators' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[#c8b89a] font-sans font-semibold">{users.length} User{users.length !== 1 ? 's' : ''}</h2>
            </div>
            <div className="bg-[#0d1b2a] border border-[#1e3050] rounded-xl overflow-hidden">
              <div className="grid grid-cols-4 gap-4 px-5 py-3 border-b border-[#1e3050] text-[#5a6a7a] font-sans text-xs uppercase tracking-wider">
                <span>Name / Email</span><span>Role</span><span>Church</span><span></span>
              </div>
              {users.map(u => (
                <div key={u.id} className="grid grid-cols-4 gap-4 items-center px-5 py-3 border-b border-[#0f1f2f] last:border-0">
                  <div>
                    <p className="text-[#c8b89a] font-sans text-sm">{u.full_name || '—'}</p>
                    <p className="text-[#4a5a6a] font-sans text-xs">{u.id.slice(0,8)}…</p>
                  </div>
                  <select value={u.role} onChange={e => changeRole(u.id, e.target.value)} className={SEL}>
                    {['operator','church_admin','org_admin'].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select value={u.church_id || ''} onChange={e => assignChurch(u.id, e.target.value)} className={SEL}>
                    <option value="">— unassigned —</option>
                    {churches.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                  </select>
                  <span />
                </div>
              ))}
            </div>
            <p className="text-[#4a5a6a] font-sans text-xs">
              To add a new operator, ask them to sign up at <span className="text-[#8a9aaa]">{window.location.origin}/login</span>, then assign them to a church here.
            </p>
          </div>
        )}

        {/* ── Settings tab ───────────────────────────────────────── */}
        {tab === 'settings' && (
          <div className="max-w-md space-y-6">
            <form onSubmit={saveOrgName} className="bg-[#0d1b2a] border border-[#1e3050] rounded-xl p-6 space-y-4">
              <h3 className="text-[#d4af37] font-sans font-semibold text-sm">Organisation</h3>
              <div>
                <label className={LBL}>Organisation name</label>
                <input value={orgName} onChange={e => setOrgName(e.target.value)} className={INP} />
              </div>
              <button type="submit" disabled={orgSaving}
                className="bg-[#d4af37] hover:bg-[#c4a030] disabled:opacity-50 text-[#0d1b2a] font-sans font-semibold px-4 py-2 rounded-lg text-sm transition-colors">
                {orgSaving ? 'Saving…' : 'Save'}
              </button>
            </form>
            <div className="bg-[#0d1b2a] border border-[#1e3050] rounded-xl p-6">
              <p className="text-[#5a6a7a] font-sans text-xs">
                White-label branding (logo, colours) is configured per-church in the <button onClick={() => setTab('churches')} className="text-[#d4af37] hover:underline">Churches tab</button>.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
