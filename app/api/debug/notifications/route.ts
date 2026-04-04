import { getSupabaseAdminClient } from '../../../../lib/supabaseAdmin';

export async function GET() {
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('Debug notifications fetch error:', error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json({ notifications: data || [] });
  } catch (err: any) {
    console.error('Debug notifications exception:', err?.message ?? err);
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
