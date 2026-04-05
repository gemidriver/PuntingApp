"use client";

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../lib/supabase';

export default function AdminPaymentsPage() {
  const [pending, setPending] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(false);

  async function fetchPending() {
    setLoading(true);
    try {
      const sup = getSupabaseClient();
      const { data: sessionData } = await sup.auth.getSession();
      if (!sessionData?.session?.access_token) return;
      const res = await fetch('/api/admin/payments/list', { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } });
      if (!res.ok) return;
      const payload = await res.json().catch(() => ({} as any));
      setPending(Array.isArray(payload.pending) ? payload.pending : []);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPending();
  }, []);

  async function confirmPayment(paymentId: string) {
    try {
      const sup = getSupabaseClient();
      const { data: sessionData } = await sup.auth.getSession();
      if (!sessionData?.session?.access_token) return;
      const res = await fetch('/api/admin/payments/confirm', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
        body: JSON.stringify({ paymentId, status: 'confirmed' }),
      });
      if (res.ok) fetchPending();
    } catch (e) {
      // ignore
    }
  }

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Admin — Pending Payments</h2>
      {loading ? <div>Loading...</div> : null}
      {pending.length === 0 ? <div>No pending payments.</div> : (
        <div className="space-y-3">
          {pending.map((row: any) => (
            <div key={row.payment.id} className="p-3 border rounded bg-white flex items-center justify-between">
              <div>
                <div className="font-medium">{row.profile?.username ?? row.payment.user_id}</div>
                <div className="text-sm text-slate-500">{row.profile?.email ?? ''}</div>
                <div className="text-sm">Meet: {row.payment.meet_id ?? '—'}</div>
                <div className="text-sm">Amount: {row.payment.amount} {row.payment.currency}</div>
                <div className="text-xs text-slate-400">Created: {new Date(row.payment.created_at).toLocaleString()}</div>
              </div>
              <div>
                <button onClick={() => confirmPayment(row.payment.id)} className="px-3 py-1 bg-emerald-600 text-white rounded">Confirm</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
