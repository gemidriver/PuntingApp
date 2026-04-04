import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../../../../lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const accessToken = authHeader.slice(7);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return Response.json({ error: 'Supabase env missing' }, { status: 500 });

    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await client.auth.getUser(accessToken);
    if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await client.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!profile?.is_admin) return Response.json({ error: 'Admin required' }, { status: 403 });

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin.from('race_history').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) {
      console.error('race_history select error:', error);
      return Response.json({ error: 'Failed to fetch race_history' }, { status: 500 });
    }

    return Response.json({ rows: data || [] });
  } catch (err) {
    console.error('admin race-history error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
