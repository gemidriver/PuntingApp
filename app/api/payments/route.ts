import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../../../lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return Response.json({ error: 'Supabase env missing' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const url = new URL(request.url);
    const meetId = url.searchParams.get('meetId');

    if (meetId) {
      // Use admin client so RLS doesn't block reading user_eligibilities
      const adminClient = getSupabaseAdminClient();
      const { data, error } = await adminClient.rpc('jackpot_for_meet', { target_meet: meetId });
      if (error) return Response.json({ error: 'Failed to fetch jackpot' }, { status: 500 });
      // RPC returns a table (array) — extract the first row
      const row = Array.isArray(data) ? data[0] : data;
      return Response.json({ jackpot: row });
    }

    // otherwise, try to return current user's payments if auth header present
    const authHeader = request.headers.get('authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const sup = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: userRes } = await sup.auth.getUser(token);
      const user = (userRes as any)?.user;
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

      const { data, error } = await sup.from('payments').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
      if (error) return Response.json({ error: 'Failed to fetch payments' }, { status: 500 });
      return Response.json({ payments: data || [] });
    }

    return Response.json({ error: 'meetId required or Authorization header' }, { status: 400 });
  } catch (err) {
    console.error('Payments GET error', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return Response.json({ error: 'Supabase env missing' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const token = authHeader.slice(7).trim();

    const sup = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userRes, error: authErr } = await sup.auth.getUser(token);
    const user = (userRes as any)?.user;
    if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({} as any));
    const amount = Number(body.amount || 0);
    const meetId = body.meetId || null;
    const currency = body.currency || 'USD';

    if (!amount || amount <= 0) return Response.json({ error: 'Invalid amount' }, { status: 400 });

    const { data, error } = await sup.from('payments').insert([{ user_id: user.id, meet_id: meetId, amount, currency }]).select().single();
    if (error) return Response.json({ error: 'Failed to create payment' }, { status: 500 });
    return Response.json({ payment: data });
  } catch (err) {
    console.error('Payments POST error', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
