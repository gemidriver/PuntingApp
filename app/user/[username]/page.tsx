"use client";

import React, { useEffect, useState } from 'react';
import Avatar from '../../../components/Avatar';
import MobileBottomNav from '../../../components/MobileBottomNav';
import Link from 'next/link';
import { getSupabaseClient } from '../../../lib/supabase';
import { useRouter } from 'next/navigation';
import { useUser } from '../../../lib/useUser';

// User profile page (client) — shows avatar and links to avatar selector
export default function UserProfilePage({ params }: { params: { username: string } }) {
  const { username } = params;
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<Array<any>>([]);
  const router = useRouter();
  const { username: currentUsername } = useUser();
  const [notifications, setNotifications] = useState<Array<any>>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getUser().then(({ data }) => {
      const user = (data as any)?.user;
      const metaAvatar = user?.user_metadata?.avatar_url;
      if (metaAvatar) setAvatarUrl(metaAvatar);
    });

    // fetch chat messages and show those authored by or mentioning this username
    (async () => {
      try {
        const res = await fetch('/api/chat');
        const data = await res.json();
        if (data?.messages) {
          const filtered = (data.messages as Array<any>).filter((m) => {
            if (!m || !m.message) return false;
            const lower = m.message.toLowerCase();
            return (m.username && m.username.toLowerCase() === username.toLowerCase()) || lower.includes('@' + username.toLowerCase());
          });
          setMessages(filtered);
        }
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  // fetch notifications for the signed-in user when viewing their own profile
  useEffect(() => {
    if (!currentUsername) return;
    if (currentUsername.toLowerCase() !== username.toLowerCase()) return;

    (async () => {
      setLoadingNotes(true);
      try {
        const supabase = getSupabaseClient();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session?.access_token) return;
        const res = await fetch('/api/notifications', { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } });
        if (!res.ok) return;
        const payload = await res.json().catch(() => ({} as any));
        setNotifications(Array.isArray(payload.notifications) ? payload.notifications : []);
      } catch (e) {
        // ignore
      } finally {
        setLoadingNotes(false);
      }
    })();
  }, [currentUsername, username]);

  async function markNotificationsRead(ids?: number[]) {
    try {
      const supabase = getSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session?.access_token) return;
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
        body: JSON.stringify(ids && ids.length ? { notificationIds: ids } : {}),
      });
      if (ids && ids.length) {
        setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
      } else {
        setNotifications([]);
      }
    } catch (e) {
      // ignore
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-8">
      <div className="flex flex-col items-center bg-white rounded-xl shadow-lg p-8 w-full max-w-lg">
        <Avatar username={username} avatarUrl={avatarUrl} size={72} />
        <h2 className="mt-4 text-2xl font-bold text-slate-900">{username}</h2>
        <div className="mt-4 w-full">
          <h3 className="text-lg font-semibold mb-2 text-slate-900">Notifications</h3>
          <div className="bg-slate-100 rounded p-3 text-slate-700 mb-6">(Notifications will appear here)</div>
          <h3 className="text-lg font-semibold mb-2 text-slate-900">Chat</h3>
          <div className="bg-slate-100 rounded p-3 text-slate-700">
            {messages.length === 0 ? (
              <div className="text-sm text-slate-500">No recent chat messages mentioning or from this user.</div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((m) => (
                  <div key={m.id} className="p-2 bg-white rounded border">
                    <div className="text-sm font-medium text-sky-700">{m.username}:</div>
                    <div className="text-sm text-slate-800">{m.message}</div>
                    <div className="text-xs text-slate-400 mt-1">{new Date(m.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex gap-4">
          <Link href={`/${'user'}/${username}/avatar-select`} className="text-blue-600 hover:underline">Change avatar</Link>
        </div>

        <div className="mt-6 flex flex-col items-center w-full">
          <Link href="/" className="text-sm text-slate-500">Back to app</Link>

          <button
            onClick={async () => {
              const supabase = getSupabaseClient();
              try {
                await supabase.auth.signOut();
              } catch (e) {
                // ignore errors
              }
              router.push('/');
            }}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Log out
          </button>
        </div>
      </div>

      <MobileBottomNav
        activeScreen={'home'}
        setActiveScreen={(s: string) => {
          // simple navigation mapping from profile view
          if (s === 'home') return void router.push('/');
          return void router.push('/');
        }}
        showLogout
        onLogout={async () => {
          const supabase = getSupabaseClient();
          try {
            await supabase.auth.signOut();
          } catch (e) {
            // ignore
          }
          router.push('/');
        }}
      />
    </div>
  );
}