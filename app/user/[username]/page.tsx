"use client";

import React, { useEffect, useState } from 'react';
import Avatar from '../../../components/Avatar';
import Link from 'next/link';
import { getSupabaseClient } from '../../../lib/supabase';

// User profile page (client) — shows avatar and links to avatar selector
export default function UserProfilePage({ params }: { params: { username: string } }) {
  const { username } = params;
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getUser().then(({ data }) => {
      const user = (data as any)?.user;
      const metaAvatar = user?.user_metadata?.avatar_url;
      if (metaAvatar) setAvatarUrl(metaAvatar);
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-8">
      <div className="flex flex-col items-center bg-white rounded-xl shadow-lg p-8 w-full max-w-lg">
        <Avatar username={username} avatarUrl={avatarUrl} size={72} />
        <h2 className="mt-4 text-2xl font-bold">{username}</h2>
        <div className="mt-4 w-full">
          <h3 className="text-lg font-semibold mb-2">Notifications</h3>
          <div className="bg-slate-100 rounded p-3 text-slate-700 mb-6">(Notifications will appear here)</div>
          <h3 className="text-lg font-semibold mb-2">Chat</h3>
          <div className="bg-slate-100 rounded p-3 text-slate-700">(Chat messages will appear here)</div>
        </div>

        <div className="mt-6 flex gap-4">
          <Link href={`/${'user'}/${username}/avatar-select`} className="text-blue-600 hover:underline">Change avatar</Link>
          <Link href="#" className="text-gray-600 hover:underline">Settings</Link>
        </div>

        <div className="mt-6">
          <Link href="#" className="text-sm text-slate-500">Back</Link>
        </div>
      </div>
    </div>
  );
}