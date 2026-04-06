"use client";

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../lib/supabase';

export default function AdminSubmissionsPanel({ defaultMeetId = 'current' }: { defaultMeetId?: string }) {
  const [rows, setRows] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(false);
  const [meetId, setMeetId] = useState(defaultMeetId);
  const [toast, setToast] = useState<string | null>(null);

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

  useEffect(() => { fetchList(); }, [meetId]);

  async function approve(userId: string) {
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
        } catch (e) {
          // ignore and fall back to literal
        }
      }

      const sup = getSupabaseClient();
      const { data: sessionData } = await sup.auth.getSession();
      if (!sessionData?.session?.access_token) return;
      const res = await fetch('/api/admin/eligibilities/set', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
        body: JSON.stringify({ userId, meetId: resolvedMeetId, eligible: true }),
      });
      if (res.ok) {
        setRows((prev) => prev.map((r) => (r.submission.user_id === userId ? { ...r, eligibility: { ...(r.eligibility || {}), eligible: true } } : r)));
        setToast('User approved ✓');
        setTimeout(() => setToast(null), 3000);
      }
    } catch (e) {
      // ignore
    }
  }

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Admin — Submissions & Approvals</h2>
      <div className="mb-4">
        <label className="text-sm mr-2">Meet:</label>
        <input value={meetId} onChange={(e) => setMeetId(e.target.value)} className="border px-2 py-1 rounded" />
        <button onClick={fetchList} className="ml-2 px-3 py-1 bg-sky-600 text-white rounded">Reload</button>
      </div>

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded shadow-lg transition-opacity">{toast}</div>
      )}

      {loading ? <div>Loading...</div> : null}

      {rows.length === 0 ? <div>No submissions found.</div> : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.submission.user_id} className="p-3 border rounded bg-white flex items-center justify-between">
              <div>
                <div className="font-medium">{r.profile?.username ?? r.submission.user_id}</div>
                <div className="text-sm text-slate-500">{r.profile?.email ?? ''}</div>
                <div className="text-sm">Submitted: {r.submission.submitted_at ?? '—'}</div>
                <div className="text-sm">Payments: {r.payments.total} (confirmed: {r.payments.confirmed})</div>
                <div className="text-sm">Eligible: {r.eligibility?.eligible ? 'Yes' : 'No'}</div>
              </div>
              <div>
                {r.eligibility?.eligible
                  ? <button disabled className="px-3 py-1 bg-slate-300 text-slate-500 rounded cursor-not-allowed">Approved</button>
                  : <button onClick={() => approve(r.submission.user_id)} className="px-3 py-1 bg-emerald-600 text-white rounded">Approve</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
