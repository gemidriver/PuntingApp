import { createClient } from '@supabase/supabase-js';

const ENTRY_FEE = 15;
const ENTRY_CURRENCY = 'AUD';

/**
 * POST /api/admin/payments/record
 * Admin-only: create a confirmed payment record for a user who has no payment row.
 * Body: { userId: string; meetId: string; amount?: number }
 */
export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return Response.json({ error: 'Supabase env missing' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const token = authHeader.slice(7).trim();

    // Verify caller is admin using their token
    const callerSup = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userRes, error: authErr } = await callerSup.auth.getUser(token);
    const adminUser = (userRes as any)?.user;
    if (authErr || !adminUser) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: adminProfile } = await callerSup.from('profiles').select('is_admin').eq('id', adminUser.id).maybeSingle();
    if (!adminProfile?.is_admin) return Response.json({ error: 'Admin only' }, { status: 403 });

    const body = await request.json().catch(() => ({} as any));
    const { userId, meetId, amount } = body;
    if (!userId || !meetId) return Response.json({ error: 'userId and meetId are required' }, { status: 400 });

    const fee = Number(amount ?? ENTRY_FEE);
    const now = new Date().toISOString();

    // Use service role if available so we can bypass RLS
    const adminSup = supabaseServiceKey
      ? createClient(supabaseUrl, supabaseServiceKey)
      : callerSup;

    // Check if payment already exists for this user+meet
    const { data: existing } = await adminSup
      .from('payments')
      .select('id, status')
      .eq('user_id', userId)
      .eq('meet_id', meetId)
      .in('status', ['pending', 'confirmed'])
      .maybeSingle();

    let paymentId: string;

    if (existing) {
      paymentId = existing.id;
      if (existing.status !== 'confirmed') {
        // Confirm the existing pending payment
        await adminSup.from('payments').update({
          status: 'confirmed',
          confirmed_at: now,
          confirmed_by: adminUser.id,
        }).eq('id', paymentId);
      }
    } else {
      // Create a new confirmed payment
      const { data: inserted, error: insertErr } = await adminSup
        .from('payments')
        .insert({
          user_id: userId,
          meet_id: meetId,
          amount: fee,
          currency: ENTRY_CURRENCY,
          status: 'confirmed',
          confirmed_at: now,
          confirmed_by: adminUser.id,
        })
        .select('id')
        .single();

      if (insertErr || !inserted) {
        console.error('Failed to insert payment', insertErr);
        return Response.json({ error: 'Failed to create payment' }, { status: 500 });
      }
      paymentId = inserted.id;
    }

    // Upsert eligibility as confirmed
    const { error: eligErr } = await adminSup.from('user_eligibilities').upsert(
      { user_id: userId, meet_id: meetId, eligible: true, confirmed_at: now, confirmed_by: adminUser.id },
      { onConflict: 'user_id,meet_id' }
    );
    if (eligErr) console.error('Failed to upsert eligibility', eligErr);

    return Response.json({ success: true, paymentId });
  } catch (err) {
    console.error('Admin record payment error', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
