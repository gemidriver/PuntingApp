import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

type RaceResultEntry = {
  winnerId: string;
  winnerName: string | null;
  secondId?: string | null;
  secondName?: string | null;
  thirdId?: string | null;
  thirdName?: string | null;
};

type Selection = {
  meetId?: string;
  raceId: string;
  raceName: string;
  horseId: string;
  horseName: string;
};

type Wildcard = {
  meetId: string;
  raceId: string;
};

type SubmissionRow = {
  user_id: string;
  username: string;
  selections: Selection[];
  wildcard: Wildcard | null;
  submitted: boolean;
};

type Meet = {
  meet_id: string;
  course: string;
  date: string;
};

type RaceResultRow = {
  race_id: string;
  horse_id: string;
  horse_name: string | null;
  finishing_position: number;
};

const normalizeHorseNameForComparison = (value: string | null | undefined) => {
  return String(value || '')
    .trim()
    .replace(/^\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

const extractHorseNumber = (value: string | null | undefined): number | null => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const prefixedMatch = trimmed.match(/^(\d+)\.\s*/);
  if (prefixedMatch) {
    return Number(prefixedMatch[1]);
  }

  const runnerMatch = trimmed.match(/runner\s+(\d+)$/i);
  if (runnerMatch) {
    return Number(runnerMatch[1]);
  }

  return null;
};

const buildRaceResultsMap = (rows: RaceResultRow[]): Record<string, RaceResultEntry> => {
  const map: Record<string, RaceResultEntry> = {};

  rows.forEach((row) => {
    if (!map[row.race_id]) {
      map[row.race_id] = {
        winnerId: '',
        winnerName: null,
        secondId: null,
        secondName: null,
        thirdId: null,
        thirdName: null,
      };
    }

    if (row.finishing_position === 1) {
      map[row.race_id].winnerId = row.horse_id;
      map[row.race_id].winnerName = row.horse_name;
    } else if (row.finishing_position === 2) {
      map[row.race_id].secondId = row.horse_id;
      map[row.race_id].secondName = row.horse_name;
    } else if (row.finishing_position === 3) {
      map[row.race_id].thirdId = row.horse_id;
      map[row.race_id].thirdName = row.horse_name;
    }
  });

  return map;
};

const selectionMatchesPlace = (
  selectionHorseId: string,
  selectionHorseName: string,
  placeHorseId: string | null | undefined,
  placeHorseName: string | null | undefined
) => {
  if (!placeHorseId && !placeHorseName) return false;
  if (placeHorseId && selectionHorseId === placeHorseId) return true;

  const selectionName = normalizeHorseNameForComparison(selectionHorseName);
  const placeName = normalizeHorseNameForComparison(placeHorseName);
  if (selectionName && placeName && selectionName === placeName) return true;

  const selectionNumber = extractHorseNumber(selectionHorseName);
  const placeNumber = extractHorseNumber(placeHorseName);
  if (selectionNumber !== null && placeNumber !== null && selectionNumber === placeNumber) {
    return true;
  }

  return false;
};

const getPointsForSelection = (selection: Selection, wildcard: Wildcard | null, raceResult?: RaceResultEntry) => {
  if (!raceResult) return 0;

  let basePoints = 0;
  if (selectionMatchesPlace(selection.horseId, selection.horseName, raceResult.winnerId, raceResult.winnerName)) {
    basePoints = 4;
  } else if (selectionMatchesPlace(selection.horseId, selection.horseName, raceResult.secondId, raceResult.secondName)) {
    basePoints = 2;
  } else if (selectionMatchesPlace(selection.horseId, selection.horseName, raceResult.thirdId, raceResult.thirdName)) {
    basePoints = 1;
  }

  const wildcardMultiplier = wildcard && wildcard.raceId === selection.raceId ? 2 : 1;
  return basePoints * wildcardMultiplier;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as { testOnly?: boolean }));
    const testOnly = Boolean(body.testOnly);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return Response.json({ error: 'Supabase environment variables are missing.' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accessToken = authHeader.slice(7);
    if (!accessToken) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(accessToken);

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: ownProfile, error: ownProfileError } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (ownProfileError || !ownProfile?.is_admin) {
      return Response.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
    const resendFromEmail = String(process.env.RESEND_FROM_EMAIL || '').trim();
    if (!resendApiKey || !resendFromEmail) {
      return Response.json({ error: 'Email provider is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.' }, { status: 400 });
    }

    const resend = new Resend(resendApiKey);

    const { data: submissions, error: submissionsError } = await supabase
      .from('user_submissions')
      .select('user_id,username,selections,wildcard,submitted')
      .eq('submitted', true)
      .order('username', { ascending: true });

    if (submissionsError) {
      return Response.json({ error: `Unable to load submissions. ${submissionsError.message}` }, { status: 500 });
    }

    const submissionRows: SubmissionRow[] = (submissions || []).map((row: any) => ({
      user_id: row.user_id,
      username: row.username,
      selections: Array.isArray(row.selections) ? row.selections : [],
      wildcard: row.wildcard || null,
      submitted: Boolean(row.submitted),
    }));

    if (!submissionRows.length) {
      return Response.json({ error: 'No submitted contestants found yet.' }, { status: 400 });
    }

    const userIds = [...new Set(submissionRows.map((row) => row.user_id).filter(Boolean))];
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id,email,username')
      .in('id', userIds);

    if (profilesError) {
      return Response.json({ error: `Unable to load contestant emails. ${profilesError.message}` }, { status: 500 });
    }

    const profileById = new Map((profiles || []).map((profile: any) => [profile.id, profile]));

    const recipients = submissionRows
      .map((row) => {
        const profile = profileById.get(row.user_id);
        return {
          email: String(profile?.email || '').trim(),
          username: String(profile?.username || row.username || '').trim(),
        };
      })
      .filter((entry) => entry.email);

    if (!recipients.length) {
      return Response.json({ error: 'No contestant emails found for submitted users.' }, { status: 400 });
    }

    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'global_meets')
      .maybeSingle();

    const meets: Meet[] = Array.isArray(settings?.value) ? settings.value : [];

    const { data: raceResultRows, error: raceResultsError } = await supabase
      .from('race_results')
      .select('race_id,horse_id,horse_name,finishing_position')
      .in('finishing_position', [1, 2, 3]);

    if (raceResultsError) {
      return Response.json({ error: `Unable to load race results. ${raceResultsError.message}` }, { status: 500 });
    }

    const raceResultsMap = buildRaceResultsMap((raceResultRows || []) as RaceResultRow[]);

    const scoreboard = submissionRows
      .map((row) => {
        const total = row.selections.reduce((sum, selection) => {
          return sum + getPointsForSelection(selection, row.wildcard, raceResultsMap[selection.raceId]);
        }, 0);
        return { username: row.username, score: total };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.username.localeCompare(b.username);
      });

    const meetLabel = meets.length
      ? meets.map((meet) => `${meet.course} (${meet.date})`).join(' | ')
      : 'Current race day';

    const leaderboardHtml = scoreboard
      .map((entry, index) => `<li>${index + 1}. ${escapeHtml(entry.username)} - ${entry.score} pts</li>`)
      .join('');

    const raceResultsHtml = Object.entries(raceResultsMap)
      .map(([raceId, result]) => {
        const first = result.winnerName || result.winnerId || '-';
        const second = result.secondName || result.secondId || '-';
        const third = result.thirdName || result.thirdId || '-';
        return `<li>${escapeHtml(raceId)}: 1st ${escapeHtml(first)} | 2nd ${escapeHtml(second)} | 3rd ${escapeHtml(third)}</li>`;
      })
      .join('');

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 680px; margin: 0 auto;">
        <h2 style="margin-bottom: 8px;">Race Day Results</h2>
        <p style="margin-top: 0; color: #475569;">${escapeHtml(meetLabel)}</p>

        <h3 style="margin-top: 24px; margin-bottom: 8px;">Leaderboard</h3>
        <ol style="padding-left: 20px;">${leaderboardHtml || '<li>No scores yet.</li>'}</ol>

        <h3 style="margin-top: 24px; margin-bottom: 8px;">Race Placings</h3>
        <ul style="padding-left: 20px;">${raceResultsHtml || '<li>No race placings saved yet.</li>'}</ul>

        <p style="margin-top: 24px; color: #64748b; font-size: 12px;">Sent from Braddo&apos;s Punting admin panel.</p>
      </div>
    `;

    const testRecipientEmail = String(user.email || '').trim();
    const uniqueEmails = testOnly
      ? (testRecipientEmail ? [testRecipientEmail] : [])
      : [...new Set(recipients.map((recipient) => recipient.email))];

    if (!uniqueEmails.length) {
      return Response.json({ error: testOnly ? 'Your account does not have an email address.' : 'No recipient emails found.' }, { status: 400 });
    }

    const sendPromises = uniqueEmails.map((email) =>
      resend.emails.send({
        from: resendFromEmail,
        to: email,
        subject: `${testOnly ? '[TEST] ' : ''}Race Day Results Update - ${meets.length ? meets[0].date : new Date().toISOString().slice(0, 10)}`,
        html,
      })
    );

    const sendResults = await Promise.allSettled(sendPromises);
    const sentCount = sendResults.filter((result) => result.status === 'fulfilled').length;
    const failedCount = sendResults.length - sentCount;

    return Response.json({
      success: true,
      mode: testOnly ? 'test' : 'broadcast',
      recipients: uniqueEmails.length,
      sentCount,
      failedCount,
    });
  } catch (error) {
    console.error('email-results error:', error);
    return Response.json({ error: 'Failed to send results emails.' }, { status: 500 });
  }
}
