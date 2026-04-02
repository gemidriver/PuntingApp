import { getSupabaseClient } from '../../../lib/supabase';

export async function getMentionedUsers(message: string) {
  // Extract @usernames from the message (defensively handle unexpected nulls)
  const mentions = Array.from(message.matchAll(/@([\w\d_]+)/g))
    .map((m) => (m && m[1] ? m[1] : null))
    .filter((v): v is string => Boolean(v));
  if (mentions.length === 0) return [];
  const supabase = getSupabaseClient();
  // Fetch user profiles for mentioned usernames
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, username')
    .in('username', mentions);
  if (error || !data) return [];
  return data;
}
