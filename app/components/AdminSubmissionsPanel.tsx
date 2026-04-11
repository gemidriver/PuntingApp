"use client";

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../lib/supabase';

interface Meet {
  meet_id: string;
  course: string;
  date: string;
  state: string;
  raceType?: string;
}

type FilterTab = 'submitted' | 'approved' | 'not-entered';

export default function AdminSubmissionsPanel({ defaultMeetId = 'current', globalMeets = [] }: { defaultMeetId?: string; globalMeets?: Meet[] }) {
  const [rows, setRows] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(false);
  const [meetId, setMeetId] = useState(defaultMeetId);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('submitted');

  const activeMeetLabel = globalMeets.map((m) => `${m.course} (${m.date})`).join(' · ') || meetId;

  const filteredRows = rows.filter((r) => {
    const submitted = r.submission?.submitted === true;
    const approved = r.eligibility?.eligible === true;
    if (filter === 'submitted') return submitted && !approved;
    if (filter === 'approved') return approved;
    if (filter === 'not-entered') return !submitted;
    return true;
  });

  const counts = {
    submitted: rows.filter((r) => r.submission?.submitted === true && !r.eligibility?.eligible).length,
    approved: rows.filter((r) => r.eligibility?.eligible === true).length,
    'not-entered': rows.filter((r) => !r.submission?.submitted).length,
  };

  // Resolve 'current' to the actual published meet id from app settings when available
  useEffect(() => {
    (async () => {
      try {
        if (meetId !== 'current') return;
        const sup = getSupabaseClient();
        const { data: setting } = await sup.from('app_settings').select('value').eq('key', 'global_meets').maybeSingle();
        const value = setting?.value;
        if (Array.isArray(value) && value.length > 0 && value[0]?.meet_id) {
          setMeetId(value[0].meet_id);
        }
      } catch (e) {
        // ignore
      }
    })();
  }, [meetId]);

  async function fetchList() {
    setLoading(true);
    try {
      const sup = getSupabaseClient();
      const { data: sessionData } = await sup.auth.getSession();
      if (!sessionData?.session?.access_token) return;
      const res = await fetch(`/api/admin/submissions/list?meetId=${encodeURIComponent(meetId)}`, { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } });
      if (!res.ok) return;
      const payload = await res.json().catch(() => ({} as any));
      setRows(Array.isArray(payload.pending) ? payload.pending : []);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (meetId && meetId !== 'current') fetchList(); }, [meetId]);

  async function approveUser(userId: string) {
    try {
      let resolvedMeetId = meetId;
      if (resolvedMeetId === 'current') {
        try {
          const sup = getSupabaseClient();
          const { data: setting } = await sup.from('app_settings').select('value').eq('key', 'global_meets').maybeSingle();
          const value = setting?.value;
          if (Array.isArray(value) && value.length > 0 && value[0]?.meet_id) {
            resolvedMeetId = value[0].meet_id;
            setMeetId(resolvedMeetId);
          }
        } catch (e) { /* ignore */ }
      }
      const sup = getSupabaseClient();
      const { data: sessionData } = await sup.auth.getSession();
      if (!sessionData?.session?.access_token) return;

      // Record payment and set eligible in parallel
      const [payRes, eligRes] = await Promise.all([
        fetch('/api/admin/payments/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
          body: JSON.stringify({ userId, meetId: resolvedMeetId }),
        }),
        fetch('/api/admin/eligibilities/set', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
          body: JSON.stringify({ userId, meetId: resolvedMeetId, eligible: true }),
        }),
      ]);

      if (payRes.ok && eligRes.ok) {
        setRows((prev) => prev.map((r) => r.profile.id === userId
          ? { ...r, payments: { ...r.payments, total: 15, confirmed: 15 }, eligibility: { ...(r.eligibility || {}), eligible: true } }
          : r));
        setToast('Approved ✓');
        setTimeout(() => setToast(null), 3000);
      } else {
        setToast('Error: could not approve user');
        setTimeout(() => setToast(null), 4000);
      }
    } catch (e) { /* ignore */ }
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <p className="text-sm font-medium text-slate-700 mb-1">{activeMeetLabel}</p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">Meet ID:</label>
          <input value={meetId} onChange={(e) => setMeetId(e.target.value)} className="border px-2 py-1 rounded text-xs text-slate-600 w-64" />
          <button onClick={fetchList} className="px-3 py-1 bg-sky-600 text-white rounded text-sm">Reload</button>
        </div>
      </div>

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded shadow-lg transition-opacity">{toast}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
          <video src="/TP_HorseRunning_Final.mp4" autoPlay muted loop playsInline style={{ width: 28, height: 28, objectFit: 'contain' }} />
          Loading...
        </div>
      ) : null}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {([
          { key: 'submitted', label: 'Submitted tips' },
          { key: 'approved', label: 'Approved' },
          { key: 'not-entered', label: 'Not entered' },
        ] as { key: FilterTab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              filter === key
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
            <span className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 ${filter === key ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {filteredRows.length === 0 ? <div className="text-slate-500 text-sm">No users in this category.</div> : (
        <div className="space-y-3">
          {filteredRows.map((r) => (
            <div key={r.profile.id} className="p-3 border rounded bg-white flex items-center justify-between">
              <div>
                <div className="font-medium">{r.profile?.username ?? r.profile?.id}</div>
                <div className="text-sm text-slate-500">{r.profile?.email ?? ''}</div>
                <div className="text-sm text-slate-600">
                  Submitted: {r.submission?.submitted_at ? new Date(r.submission.submitted_at).toLocaleString() : '—'}
                </div>
                <div className="text-sm">
                  {r.eligibility?.eligible
                    ? <span className="text-emerald-700 font-medium">Approved — payment confirmed ✓</span>
                    : <span className="text-amber-700">Awaiting approval</span>}
                </div>
              </div>
              <div className="flex flex-col gap-2 items-end">
                {r.eligibility?.eligible
                  ? <button disabled className="px-3 py-1 bg-slate-300 text-slate-500 rounded cursor-not-allowed">Approved</button>
                  : <button onClick={() => approveUser(r.profile.id)} className="px-3 py-1 bg-emerald-600 text-white rounded">Approve</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
