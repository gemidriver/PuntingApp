"use client";

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../lib/supabase';

type RaceHistoryRow = {
  id: number;
  meet_id: string;
  race_id: string;
  race_name: string;
  course: string;
  race_time?: string;
  runners?: any[];
  meta?: Record<string, any>;
  created_at: string;
};

export default function AdminRaceHistoryPage() {
  const [rows, setRows] = useState<RaceHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const supabase = getSupabaseClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) {
          setError('Admin session not available. Sign in as an admin.');
          setLoading(false);
          return;
        }

        const res = await fetch('/api/admin/race-history', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await res.json();
        if (!res.ok) {
          setError(payload.error || 'Failed to load race history');
        } else {
          setRows(Array.isArray(payload.rows) ? payload.rows : []);
        }
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Race History (recent)</h2>
      {loading ? <p>Loading...</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="mt-3 space-y-3">
        {rows.length === 0 && !loading && !error && <p className="text-sm text-slate-600">No race history rows found.</p>}
        {rows.map((r) => (
          <div key={r.id} className="rounded border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{r.course} — {r.race_name}</div>
                <div className="text-xs text-slate-500">Meet: {r.meet_id} • Race ID: {r.race_id}</div>
              </div>
              <div className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</div>
            </div>
            {r.race_time ? <div className="mt-2 text-xs text-slate-600">Scheduled: {new Date(r.race_time).toLocaleString()}</div> : null}
            {Array.isArray(r.runners) && r.runners.length ? (
              <div className="mt-2 text-xs">
                <strong>Runners:</strong>
                <ul className="mt-1 list-disc pl-5 text-slate-700">
                  {r.runners.slice(0, 10).map((runner: any, idx: number) => (
                    <li key={idx}>{runner.number ? `${runner.number}. ` : ''}{runner.name || runner.runnerName || JSON.stringify(runner)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
