import { getSupabaseClient } from '../../../../lib/supabase';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = getSupabaseClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('is_admin, username')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !profile?.is_admin) {
      return Response.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const { data: inserted, error: insertError } = await supabase
      .from('notifications')
      .insert({
        user_id: user.id,
        race_id: `test-${Date.now()}`,
        race_name: 'Test Notification',
        course: 'App',
        notification_type: 'race_starting_soon',
        message: 'Test notification from admin panel. If you can see this, in-app notifications are working.',
      })
      .select('id')
      .maybeSingle();

    if (insertError) {
      return Response.json({ error: `Unable to create test notification. ${insertError.message}` }, { status: 500 });
    }

    return Response.json({ success: true, notificationId: inserted?.id ?? null });
  } catch (err) {
    console.error('notifications test route error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
