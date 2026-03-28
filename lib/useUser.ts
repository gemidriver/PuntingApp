import { useSession } from '@supabase/auth-helpers-react';
import { useEffect, useState } from 'react';
import { getSupabaseClient } from './supabase';

export function useUser() {
  const session = useSession();
  const [username, setUsername] = useState('');
  const [userId, setUserId] = useState('');
  useEffect(() => {
    if (session?.user) {
      setUserId(session.user.id);
      // Try to get username from metadata, fallback to profiles
      const metaUsername = session.user.user_metadata?.username;
      if (metaUsername) {
        setUsername(metaUsername);
      } else {
        // fallback: fetch from profiles
        getSupabaseClient()
          .from('profiles')
          .select('username')
          .eq('id', session.user.id)
          .single()
          .then(({ data }) => {
            if (data?.username) setUsername(data.username);
          });
      }
    }
  }, [session]);
  return { user: session?.user, username, userId };
}
