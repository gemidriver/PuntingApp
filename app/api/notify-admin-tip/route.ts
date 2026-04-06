import { Resend } from 'resend';
import { getSupabaseClient } from '../../../lib/supabase';
import { fetchRacesForCourse } from '../../../lib/betfair';

export const maxDuration = 30;

export async function POST(request: Request) {
  try {

    const { username, selections, wildcard, previousSelections, previousWildcard, isUpdate } = await request.json();
    if (!username || !Array.isArray(selections)) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Diff selections when this is an update
    const prevSels: any[] = Array.isArray(previousSelections) ? previousSelections : [];
    const changes: string[] = [];
    if (isUpdate && prevSels.length > 0) {
      // Build a map of raceId -> horseName for previous selections
      const prevByRace = new Map<string, any>();
      for (const s of prevSels) prevByRace.set(String(s.raceId), s);
      const newByRace = new Map<string, any>();
      for (const s of selections) newByRace.set(String(s.raceId), s);

      for (const [raceId, newSel] of newByRace) {
        const prev = prevByRace.get(raceId);
        if (!prev) {
          changes.push(`Added — ${newSel.meetCourse || newSel.meetId} ${newSel.raceName}: ${newSel.horseName}`);
        } else if (String(prev.horseId) !== String(newSel.horseId)) {
          changes.push(`Changed — ${newSel.meetCourse || newSel.meetId} ${newSel.raceName}: ${prev.horseName} → ${newSel.horseName}`);
        }
      }
      for (const [raceId, prevSel] of prevByRace) {
        if (!newByRace.has(raceId)) {
          changes.push(`Removed — ${prevSel.meetCourse || prevSel.meetId} ${prevSel.raceName}: ${prevSel.horseName}`);
        }
      }
      // Wildcard change
      const prevWcRace = previousWildcard?.raceId ? String(previousWildcard.raceId) : null;
      const newWcRace = wildcard?.raceId ? String(wildcard.raceId) : null;
      const prevWcHorse = previousWildcard?.horseId ? String(previousWildcard.horseId) : null;
      const newWcHorse = wildcard?.horseId ? String(wildcard.horseId) : null;
      if (prevWcRace !== newWcRace || prevWcHorse !== newWcHorse) {
        const prevWcLabel = prevWcRace ? `${previousWildcard?.meetId ?? ''} R${prevWcRace}: ${previousWildcard?.horseName ?? prevWcHorse}` : 'none';
        const newWcLabel = newWcRace ? `${wildcard?.meetId ?? ''} R${newWcRace}: ${wildcard?.horseName ?? newWcHorse}` : 'none';
        changes.push(`Wildcard: ${prevWcLabel} → ${newWcLabel}`);
      }
    }

    // Prepare user-friendly wildcard info. Prefer labels available in the submitted selections.
    let wildcardText = '';
    if (wildcard && wildcard.meetId && wildcard.raceId) {
      // If the wildcard matches one of the provided selections, use that selection's friendly labels
      try {
        const match = Array.isArray(selections) ? selections.find((s: any) => String(s.meetId) === String(wildcard.meetId) && String(s.raceId) === String(wildcard.raceId)) : null;
        if (match) {
          wildcardText = `${match.meetCourse || match.meetId} - ${match.raceName}${match.horseName ? `: ${match.horseName}` : ''}`;
        } else {
          // Fallback: fetch race info to provide a human-friendly label
          const { races } = await fetchRacesForCourse(wildcard.meetId, new Date().toISOString().slice(0, 10));
          const race = races.find(r => String(r.id) === String(wildcard.raceId));
          if (race) {
            wildcardText = `${race.courseId} - ${race.name}`;
          } else {
            wildcardText = `${wildcard.meetId} - ${wildcard.raceId}`;
          }
        }
      } catch {
        wildcardText = `${wildcard.meetId} - ${wildcard.raceId}`;
      }
    }

    const supabase = getSupabaseClient();
    // Fetch all admin users
    const { data: admins, error } = await supabase
      .from('profiles')
      .select('email,username')
      .eq('is_admin', true);
    if (error) {
      return Response.json({ error: 'Failed to fetch admins' }, { status: 500 });
    }
    if (!admins || admins.length === 0) {
      return Response.json({ error: 'No admin users found' }, { status: 404 });
    }

    const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
    const resendFromEmail = String(process.env.RESEND_FROM_EMAIL || '').trim();
    if (!resendApiKey || !resendFromEmail) {
      return Response.json({ error: 'Email not configured' }, { status: 500 });
    }
    const resend = new Resend(resendApiKey);

    const subject = isUpdate
      ? `Tips Updated by ${username}${changes.length ? ` (${changes.length} change${changes.length !== 1 ? 's' : ''})` : ''}`
      : `New Tips Submitted by ${username}`;

    const html = isUpdate && changes.length > 0
      ? `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Tips Updated</h2>
        <p><strong>User:</strong> ${username}</p>
        <p><strong>Changes:</strong></p>
        <ul>
          ${changes.map((c) => `<li>${c}</li>`).join('')}
        </ul>
        ${wildcardText ? `<p><strong>Wildcard:</strong> ${wildcardText}</p>` : ''}
        <p style="color: #999; font-size: 12px;">This is an automated notification from The Top Punter.</p>
      </div>
      `
      : `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${isUpdate ? 'Tips Updated (no detected changes)' : 'New Tips Submitted'}</h2>
        <p><strong>User:</strong> ${username}</p>
        <p><strong>Selections:</strong></p>
        <ul>
          ${selections.map((sel: any) => `<li>${sel.meetCourse || sel.meetId} - ${sel.raceName}: ${sel.horseName}</li>`).join('')}
        </ul>
        ${wildcardText ? `<p><strong>Wildcard:</strong> ${wildcardText}</p>` : ''}
        <p style="color: #999; font-size: 12px;">This is an automated notification from The Top Punter.</p>
      </div>
      `;

    // Send to all admins
    const emailPromises = admins.map((admin: any) =>
      resend.emails.send({
        from: resendFromEmail,
        to: admin.email,
        subject,
        html,
      })
    );
    await Promise.allSettled(emailPromises);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: 'Failed to notify admins' }, { status: 500 });
  }
}
