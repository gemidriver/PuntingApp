import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../../../lib/supabaseAdmin';

const ENTRY_FEE = 15;
const ENTRY_CURRENCY = 'AUD';

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
    // meetIds is an array of all active meet IDs for the current round
    const meetIds: string[] = Array.isArray(body.meetIds) ? body.meetIds.filter(Boolean) : [];
    if (body.meetId && !meetIds.includes(body.meetId)) meetIds.unshift(body.meetId);
    const primaryMeetId = meetIds[0] || null;
    const amount = Number(body.amount ?? ENTRY_FEE);
    const currency = body.currency || ENTRY_CURRENCY;

    if (!amount || amount <= 0) return Response.json({ error: 'Invalid amount' }, { status: 400 });

    // Idempotent: only create a payment if none already exists for this user+meet
    let paymentData: any = null;
    if (primaryMeetId) {
      const { data: existing } = await sup
        .from('payments')
        .select('id,status')
        .eq('user_id', user.id)
        .eq('meet_id', primaryMeetId)
        .in('status', ['pending', 'confirmed'])
        .maybeSingle();
      if (!existing) {
        const { data, error } = await sup
          .from('payments')
          .insert([{ user_id: user.id, meet_id: primaryMeetId, amount, currency }])
          .select()
          .single();
        if (error) return Response.json({ error: 'Failed to create payment' }, { status: 500 });
        paymentData = data;
      } else {
        paymentData = existing;
      }
    } else {
      // No meet_id — insert as before (backwards compat)
      const { data, error } = await sup
        .from('payments')
        .insert([{ user_id: user.id, meet_id: null, amount, currency }])
        .select()
        .single();
      if (error) return Response.json({ error: 'Failed to create payment' }, { status: 500 });
      paymentData = data;
    }

    // Upsert an initial eligibility record (eligible: false) for each active meet so the admin
    // can see this user in the approvals panel. Uses admin client to bypass RLS.
    if (meetIds.length) {
      try {
        const admin = getSupabaseAdminClient();
        const eligRows = meetIds.map((mid) => ({
          user_id: user.id,
          meet_id: mid,
          eligible: false,
        }));
        // Only insert if no row exists yet (don't overwrite an already-approved eligibility)
        for (const row of eligRows) {
          await admin
            .from('user_eligibilities')
            .upsert(row, { onConflict: 'user_id,meet_id', ignoreDuplicates: true });
        }
      } catch (e) {
        console.error('Failed to upsert initial eligibility on payment creation', e);
      }
    }

    return Response.json({ payment: paymentData });
  } catch (err) {
    console.error('Payments POST error', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
