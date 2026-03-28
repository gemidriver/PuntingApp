import { getSupabaseClient } from '../../../lib/supabase';

export async function getMentionedUsers(message: string) {
  // Extract @usernames from the message
  const mentions = Array.from(message.matchAll(/@([\w\d_]+)/g)).map(m => m[1]);
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
