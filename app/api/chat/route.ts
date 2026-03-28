import { getSupabaseClient } from '../../../lib/supabase';

export const maxDuration = 30;

export async function GET() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, user_id, username, message, created_at')
    .order('created_at', { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ messages: data });
}

export async function POST(request: Request) {
  const supabase = getSupabaseClient();
  const { user_id, username, message } = await request.json();
  if (!user_id || !username || !message) {
    return Response.json({ error: 'Missing fields' }, { status: 400 });
  }
  const { error } = await supabase
    .from('chat_messages')
    .insert([{ user_id, username, message }]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
