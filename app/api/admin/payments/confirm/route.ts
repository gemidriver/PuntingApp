import { createClient } from '@supabase/supabase-js';

export async function PATCH(request: Request) {
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

    // check admin flag on profiles
    const { data: profile } = await sup.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!profile || !profile.is_admin) return Response.json({ error: 'Admin only' }, { status: 403 });

    const body = await request.json().catch(() => ({} as any));
    const paymentId = body.paymentId;
    const newStatus = body.status || 'confirmed';
    if (!paymentId) return Response.json({ error: 'paymentId required' }, { status: 400 });

    // fetch payment
    const { data: payment } = await sup.from('payments').select('*').eq('id', paymentId).maybeSingle();
    if (!payment) return Response.json({ error: 'Payment not found' }, { status: 404 });

    const updates: any = { status: newStatus };
    if (newStatus === 'confirmed') {
      updates.confirmed_at = new Date().toISOString();
      updates.confirmed_by = user.id;
    }

    const { error: updateErr } = await sup.from('payments').update(updates).eq('id', paymentId);
    if (updateErr) return Response.json({ error: 'Failed to update payment' }, { status: 500 });

    // if confirmed, upsert user eligibility for the meet
    if (newStatus === 'confirmed') {
      try {
        const { error: upsertErr } = await sup.from('user_eligibilities').upsert({ user_id: payment.user_id, meet_id: payment.meet_id, eligible: true, confirmed_at: new Date().toISOString(), confirmed_by: user.id }, { onConflict: 'user_id,meet_id' });
        if (upsertErr) console.error('Failed to upsert eligibility', upsertErr);
      } catch (e) {
        console.error('Eligibility upsert error', e);
      }
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('Admin payment confirm error', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
