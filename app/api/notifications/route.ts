import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../../../lib/supabaseAdmin';

// Notification types that are only meaningful while a race meet is active.
// If the meet is no longer open, stale notifications of these types are
// auto-marked as read so the user isn't flooded with old toasts on login.
const RACE_TIMING_NOTIFICATION_TYPES = ['race_starting_soon', 'race_started', 'race_scratched'];

export async function GET(request: Request) {
  try {
    // Get user from headers or auth
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return Response.json(
        { error: 'Supabase environment variables are missing.' },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    // Verify token and get user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Log the user id being queried for debugging
    console.log('GET /api/notifications - token present, user id:', user.id);
    // Get unread notifications for user
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching notifications for user', user.id, error);
      return Response.json(
        { error: 'Failed to fetch notifications' },
        { status: 500 }
      );
    }

    console.log(`GET /api/notifications - found ${Array.isArray(notifications) ? notifications.length : 0} notifications for user ${user.id}`);
    // Do not log notification contents in production — avoid leaking PII in logs.

    // Auto-dismiss stale race-timing notifications so users who haven't logged in
    // for a while don't get flooded with toasts for meets that are already closed.
    let activeNotifications: any[] = notifications || [];
    const timeSensitive = activeNotifications.filter((n: any) =>
      RACE_TIMING_NOTIFICATION_TYPES.includes(n.notification_type)
    );

    if (timeSensitive.length > 0) {
      // Fetch the currently active meet IDs from app_settings
      const { data: settingsRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'global_meets')
        .maybeSingle();

      const activeMeetIds = new Set<string>(
        Array.isArray(settingsRow?.value)
          ? settingsRow.value.map((m: any) => String(m.meet_id)).filter(Boolean)
          : []
      );

      // Use race_reminders as the bridge from race_id → meet_id
      const timeSensitiveRaceIds = [...new Set(timeSensitive.map((n: any) => n.race_id))];
      const { data: reminderRows } = await supabase
        .from('race_reminders')
        .select('race_id, meet_id')
        .in('race_id', timeSensitiveRaceIds);

      const raceToMeet = new Map<string, string>();
      for (const r of reminderRows || []) {
        if (r.race_id && r.meet_id) raceToMeet.set(String(r.race_id), String(r.meet_id));
      }

      // A notification is stale if its meet is no longer active.
      // For race_ids with no race_reminders entry, fall back to a 12-hour heuristic.
      const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
      const staleIds: number[] = [];
      for (const n of timeSensitive) {
        const meetId = raceToMeet.get(String(n.race_id));
        if (meetId !== undefined) {
          if (!activeMeetIds.has(meetId)) staleIds.push(n.id);
        } else {
          // No reminder row found — treat as stale if older than 12 hours
          if (new Date(n.created_at).getTime() < twelveHoursAgo) staleIds.push(n.id);
        }
      }

      if (staleIds.length > 0) {
        console.log(`GET /api/notifications - auto-dismissing ${staleIds.length} stale race-meet notifications for user ${user.id}`);
        const adminClient = getSupabaseAdminClient();
        await adminClient
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .in('id', staleIds);

        activeNotifications = activeNotifications.filter((n: any) => !staleIds.includes(n.id));
      }
    }

    return Response.json({
      notifications: activeNotifications,
    });
  } catch (err) {
    console.error('Notifications API error:', err);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return Response.json(
        { error: 'Supabase environment variables are missing.' },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json() as { notificationIds?: number[]; clearType?: string };

    if (Array.isArray(body.notificationIds) && body.notificationIds.length) {
      // Mark specific notifications as read
      const { error: updateError } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .in('id', body.notificationIds);

      if (updateError) {
        console.error('Error marking notifications as read:', updateError);
      }
    } else if (body.clearType) {
      // Mark all notifications of a specific type as read (e.g., 'chat')
      const { error: updateError } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('notification_type', body.clearType)
        .is('read_at', null);

      if (updateError) {
        console.error('Error clearing notifications by type:', updateError);
      }
    } else {
      // Mark all notifications as read
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .is('read_at', null);
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('Notifications PATCH error:', err);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
