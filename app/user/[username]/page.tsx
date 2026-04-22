"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Avatar from '../../../components/Avatar';
import MobileBottomNav from '../../../components/MobileBottomNav';
import Link from 'next/link';
import { getSupabaseClient } from '../../../lib/supabase';
import { useRouter } from 'next/navigation';
import { useUser } from '../../../lib/useUser';

function SwipeableNotificationRow({
  onDismiss,
  children,
}: {
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const THRESHOLD = 80;
  const elRef = useRef<HTMLDivElement>(null);
  const startX = useRef<number | null>(null);
  const currentX = useRef(0);
  const dismissed = useRef(false);

  const applyTransform = (x: number, transition = false) => {
    const el = elRef.current;
    if (!el) return;
    const opacity = Math.max(0, 1 - Math.abs(x) / (THRESHOLD * 1.5));
    el.style.transition = transition ? 'transform 0.18s ease, opacity 0.18s ease' : 'none';
    el.style.transform = `translateX(${x}px)`;
    el.style.opacity = String(opacity);
  };

  const dismiss = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    const el = elRef.current;
    if (el) {
      el.style.transition = 'transform 0.18s ease, opacity 0.18s ease';
      el.style.transform = `translateX(${currentX.current >= 0 ? 320 : -320}px)`;
      el.style.opacity = '0';
    }
    setTimeout(onDismiss, 180);
  }, [onDismiss]);

  return (
    <div
      ref={elRef}
      className="rounded bg-white border flex items-start gap-2"
      style={{ touchAction: 'pan-y', userSelect: 'none', willChange: 'transform', overflow: 'hidden' }}
      onTouchStart={(e) => {
        startX.current = e.touches[0].clientX;
        applyTransform(0, false);
      }}
      onTouchMove={(e) => {
        if (startX.current === null) return;
        const x = e.touches[0].clientX - startX.current;
        currentX.current = x;
        applyTransform(x, false);
      }}
      onTouchEnd={() => {
        if (Math.abs(currentX.current) >= THRESHOLD) {
          dismiss();
        } else {
          currentX.current = 0;
          applyTransform(0, true);
        }
        startX.current = null;
      }}
    >
      <div className="flex-1 p-3">{children}</div>
      <button
        onClick={dismiss}
        aria-label="Dismiss notification"
        className="px-3 py-3 text-slate-400 hover:text-slate-700 text-lg leading-none flex-shrink-0 self-start"
      >
        ×
      </button>
    </div>
  );
}

// User profile page (client) — shows avatar and links to avatar selector
export default function UserProfilePage({ params }: { params: { username: string } }) {
  const { username } = params;
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const router = useRouter();
  const { username: currentUsername } = useUser();
  const [notifications, setNotifications] = useState<Array<any>>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [emailReminders, setEmailReminders] = useState<boolean>(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [emailPrefLoading, setEmailPrefLoading] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getUser().then(({ data }) => {
      const user = (data as any)?.user;
      const metaAvatar = user?.user_metadata?.avatar_url;
      if (metaAvatar) setAvatarUrl(metaAvatar);
      if (user?.id) setCurrentUserId(user.id);
    });
  }, []);

  // Fetch email reminder preference when viewing own profile
  useEffect(() => {
    if (!currentUserId || !currentUsername || currentUsername.toLowerCase() !== username.toLowerCase()) return;
    const supabase = getSupabaseClient();
    supabase
      .from('profiles')
      .select('email_reminders')
      .eq('id', currentUserId)
      .single()
      .then(({ data }) => {
        if (data && typeof data.email_reminders === 'boolean') {
          setEmailReminders(data.email_reminders);
        }
      });
  }, [currentUserId, currentUsername, username]);

  async function toggleEmailReminders() {
    if (!currentUserId) return;
    const newValue = !emailReminders;
    setEmailReminders(newValue);
    setEmailPrefLoading(true);
    try {
      const supabase = getSupabaseClient();
      await supabase.from('profiles').update({ email_reminders: newValue }).eq('id', currentUserId);
    } catch (e) {
      setEmailReminders(!newValue); // revert on error
    } finally {
      setEmailPrefLoading(false);
    }
  }

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
    <div className="h-screen bg-slate-50 flex flex-col items-center p-4 overflow-hidden">
      <div className="flex flex-col items-center bg-white rounded-xl shadow-lg p-4 w-full max-w-lg profile-card overflow-visible">
        <div className="w-full flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-900">{username}</h2>
          <button
            onClick={async () => {
              const supabase = getSupabaseClient();
              try { await supabase.auth.signOut(); } catch (e) { /* ignore */ }
              router.push('/');
            }}
            aria-label="Log out"
            className="px-3 py-1 bg-red-600 text-white rounded text-sm"
          >
            Log out
          </button>
        </div>

        <div className="mt-2 flex flex-col items-center w-full">
          <Avatar username={username} avatarUrl={avatarUrl} size={96} />
          <div className="mt-1">
            <Link href={`/${'user'}/${username}/avatar-select`} className="text-blue-600 hover:underline">Change avatar</Link>
          </div>
        </div>
        <div className="mt-2 w-full flex-1 overflow-visible">
          {/* Email preferences — only shown to the profile owner */}
          {currentUsername && currentUsername.toLowerCase() === username.toLowerCase() && (
            <div className="w-full mb-4">
              <h3 className="text-lg font-semibold mb-2 text-slate-900">Email Preferences</h3>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={emailReminders}
                  onChange={toggleEmailReminders}
                  disabled={emailPrefLoading}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="text-sm text-slate-700">Race email notifications</span>
              </label>
              <p className="text-xs text-slate-400 mt-1">
                Receive emails when a race is about to start.
              </p>
            </div>
          )}
          {/* Jackpot moved to Submissions page */}
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold mb-2 text-slate-900">Notifications</h3>
            <div>
              <button
                onClick={async () => {
                  // Clear all notifications for this user
                  try {
                    const supabase = getSupabaseClient();
                    const { data: sessionData } = await supabase.auth.getSession();
                    if (!sessionData?.session?.access_token) return;
                    await fetch('/api/notifications', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
                      body: JSON.stringify({}),
                    });
                    setNotifications([]);
                    try { window.dispatchEvent(new Event('app:clearNotifications')); } catch (e) { /* ignore */ }
                  } catch (e) {
                    // ignore
                  }
                }}
                className="rounded-full bg-amber-200 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-300"
              >
                Mark all notifications as read
              </button>
            </div>
          </div>
          <div className="bg-slate-100 rounded p-3 text-slate-700 mb-6">
            {notifications.length === 0 ? (
              <div className="text-sm text-slate-500">No notifications yet.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {notifications.map((n) => (
                  <SwipeableNotificationRow key={n.id} onDismiss={() => markNotificationsRead([n.id])}>
                    <div className="text-sm font-medium text-slate-800">{n.message}</div>
                    <div className="text-xs text-slate-400">{new Date(n.created_at).toLocaleString()}</div>
                  </SwipeableNotificationRow>
                ))}
              </div>
            )}
          </div>

        </div>

        <div className="mt-6 flex flex-col items-center w-full">
          <Link href="/" className="text-sm text-slate-500 hidden lg:inline">Back to app</Link>
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
      <style jsx>{`
        .profile-card { max-height: calc(100vh - 4rem); }
      `}</style>
    </div>
  );
}