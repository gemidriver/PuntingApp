"use client";

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../../lib/supabase';
import Avatar from '../../../../components/Avatar';
import { useRouter, useParams } from 'next/navigation';

const defaultAvatars = [
    'toppunter1.jpg',
    'toppunter2.jpg',
    'toppunter3.jpg',
    'toppunter4.jpg',
    'toppunter5.jpg',
];

export default function AvatarSelect() {
    const router = useRouter();
    const params = useParams();
    const username = (params as any)?.username;

    const [currentUrl, setCurrentUrl] = useState<string | undefined>(undefined);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const supabase = getSupabaseClient();
        supabase.auth.getUser().then(({ data }) => {
            const user = (data as any)?.user;
            setCurrentUrl(user?.user_metadata?.avatar_url);
        });
    }, []);

    async function updateUserAvatar(url: string) {
        setError(null);
        const supabase = getSupabaseClient();
        const { error: updErr } = await supabase.auth.updateUser({ data: { avatar_url: url } });
        if (updErr) {
            setError(updErr.message || 'Failed to update avatar');
            return;
        }
        router.push(`/user/${username}`);
    }

    async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        setError(null);
        try {
            const supabase = getSupabaseClient();
            const { data: userData } = await supabase.auth.getUser();
            const user = (userData as any)?.user;
            if (!user) throw new Error('Not signed in');
            const path = `${user.id}/${Date.now()}_${file.name}`;
            const { data: uploadData, error: uploadErr } = await supabase.storage.from('avatars').upload(path, file);
            if (uploadErr) throw uploadErr;
            const uploadedPath = (uploadData as any)?.path || path;
            const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(uploadedPath);
            const publicUrl = (publicData as any)?.publicUrl;
            if (!publicUrl) throw new Error('Could not get public URL');
            await updateUserAvatar(publicUrl);
        } catch (err: any) {
            setError(err?.message || String(err));
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center p-8">
            <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-lg">
                <h2 className="text-2xl font-bold">Choose an avatar</h2>

                <div className="mt-6 flex items-center gap-4">
                    <div>Current:</div>
                    <Avatar username={username || 'user'} avatarUrl={currentUrl} size={56} />
                </div>

                <div className="mt-6">
                    <h3 className="font-semibold mb-2">Defaults</h3>
                    <div className="grid grid-cols-5 gap-3">
                        {defaultAvatars.map((f) => {
                            const url = `/avatars/${f}`;
                            return (
                                <button key={f} onClick={() => updateUserAvatar(url)} className="rounded overflow-hidden border-2">
                                    <img src={url} alt={f} style={{ width: 72, height: 72, objectFit: 'cover' }} />
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="mt-6">
                    <h3 className="font-semibold mb-2">Upload</h3>
                    <input type="file" accept="image/*" onChange={handleFile} />
                    {uploading && <div className="text-sm text-slate-500 mt-2">Uploading...</div>}
                </div>

                {error && <div className="mt-4 text-red-600">{error}</div>}

                <div className="mt-6 flex justify-between">
                    <button onClick={() => router.back()} className="text-gray-600 hover:underline">Cancel</button>
                </div>
            </div>
        </div>
    );
}
