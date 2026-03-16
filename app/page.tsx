"use client";

import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabase';

interface Meet {
  meet_id: string;
  course: string;
  date: string;
  state: string;
}

interface Race {
  id: string;
  name: string;
  time: string;
  courseId: string;
  runners: {
    id: string;
    name: string;
    number: number;
    odds: string;
    jockey: string;
    trainer: string;
    weight: string;
    age: string;
    form: string;
    colours: string;
  }[];
}

interface Selection {
  meetId: string;
  meetCourse?: string;
  raceId: string;
  raceName: string;
  horseId: string;
  horseName: string;
}

interface Wildcard {
  meetId: string;
  raceId: string;
}

interface UserSelections {
  username: string;
  selections: Selection[];
  wildcard: Wildcard | null;
  submitted: boolean;
  submittedAt?: string;
}

interface ProfileRecord {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
}

interface SubmissionRow {
  user_id: string;
  username: string;
  selections: Selection[];
  wildcard: Wildcard | null;
  submitted: boolean;
  submitted_at: string | null;
}

const GLOBAL_MEETS_SETTING_KEY = 'global_meets';
const RACE_RESULTS_SETTING_KEY = 'race_results';

type RaceResultsMap = Record<string, { winnerId: string; winnerName: string | null }>;

const getTodayDate = () => new Date().toISOString().slice(0, 10);
const normalizeUsername = (value: string) => value.trim().toLowerCase();
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const usernameFromEmail = (email: string) => email.split('@')[0] || email;
const formatRaceTime = (value: string) => {
  if (!value) return 'Time TBC';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const getAuthRedirectUrl = () => {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return undefined;
};

export default function Home() {
  const [meets, setMeets] = useState<Meet[]>([]);
  const [selectedMeets, setSelectedMeets] = useState<Meet[]>([]);
  const [races, setRaces] = useState<{ [meetId: string]: Race[] }>({});
  const [raceLoading, setRaceLoading] = useState<{ [meetId: string]: boolean }>({});
  const [raceDebug, setRaceDebug] = useState<{ [meetId: string]: unknown }>({});
  const [selections, setSelections] = useState<Selection[]>([]);
  const [wildcard, setWildcard] = useState<Wildcard | null>(null);
  const [selectedRunnerDetails, setSelectedRunnerDetails] = useState<{ runner: any; meetId: string; raceId: string; raceName: string } | null>(null);
  const [raceExpanded, setRaceExpanded] = useState<{ [key: string]: boolean }>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [allUsers, setAllUsers] = useState<Record<string, ProfileRecord>>({});
  const [globalMeets, setGlobalMeets] = useState<Meet[]>([]);

  const [submittedSelections, setSubmittedSelections] = useState<UserSelections | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeScreen, setActiveScreen] = useState<'home' | 'main' | 'admin' | 'submissions'>('home');
  const [submissionRows, setSubmissionRows] = useState<SubmissionRow[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [raceResults, setRaceResults] = useState<RaceResultsMap>({});
  const [resultsFetching, setResultsFetching] = useState(false);
  const [manualResultRaceId, setManualResultRaceId] = useState('');
  const [manualResultHorseId, setManualResultHorseId] = useState('');
  const [manualRunnersByRaceId, setManualRunnersByRaceId] = useState<Record<string, Array<{ horseId: string; horseName: string }>>>({});
  const [manualRunnersLoading, setManualRunnersLoading] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const mapProfiles = (rows: Array<{ id: string; email: string; username: string; is_admin: boolean }>): Record<string, ProfileRecord> => {
    return rows.reduce((acc, row) => {
      const username = normalizeUsername(row.username);
      acc[username] = {
        id: row.id,
        email: row.email,
        username,
        isAdmin: Boolean(row.is_admin),
      };
      return acc;
    }, {} as Record<string, ProfileRecord>);
  };

  const persistUserSelections = async (
    currentUserId: string,
    username: string,
    currentSelections: Selection[],
    currentWildcard: Wildcard | null,
    submitted: boolean
  ) => {
    const supabase = getSupabaseClient();
    const payload = {
      user_id: currentUserId,
      username,
      selections: currentSelections,
      wildcard: currentWildcard,
      submitted,
      submitted_at: submitted ? new Date().toISOString() : null,
    };

    const { error: upsertError } = await supabase
      .from('user_submissions')
      .upsert(payload, { onConflict: 'user_id' });

    if (upsertError) {
      console.error(upsertError);
      setError('Unable to save selections to Supabase.');
    }
  };

  const loadGlobalMeetsFromDb = async () => {
    const supabase = getSupabaseClient();
    const { data, error: settingsError } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', GLOBAL_MEETS_SETTING_KEY)
      .maybeSingle();

    if (settingsError) {
      console.error(settingsError);
      return [] as Meet[];
    }

    const value = data?.value;
    if (Array.isArray(value)) {
      return value as Meet[];
    }

    return [] as Meet[];
  };

  const clearSelectionState = () => {
    setSelections([]);
    setWildcard(null);
    setSubmittedSelections(null);
    setHasSubmitted(false);
    setManualResultRaceId('');
    setManualResultHorseId('');
  };

  const clearMeetState = () => {
    setGlobalMeets([]);
    setSelectedMeets([]);
    setRaces({});
    setRaceLoading({});
    setRaceDebug({});
    setRaceExpanded({});
    setRaceResults({});
    setSubmissionRows([]);
  };

  const refreshProfiles = async () => {
    const supabase = getSupabaseClient();
    const { data, error: profilesError } = await supabase
      .from('profiles')
      .select('id,email,username,is_admin')
      .order('created_at', { ascending: true });

    if (profilesError) {
      console.error(profilesError);
      return;
    }

    setAllUsers(mapProfiles(data || []));
  };

  const loadSubmissionRows = async () => {
    setSubmissionsLoading(true);
    try {
      const supabase = getSupabaseClient();

      const query = supabase
        .from('user_submissions')
        .select('user_id,username,selections,wildcard,submitted,submitted_at')
        .order('submitted_at', { ascending: false });

      const { data, error: submissionsError } = await query;

      if (submissionsError) {
        console.error(submissionsError);
        return;
      }

      const rows: SubmissionRow[] = (data || []).map((row: any) => ({
        user_id: row.user_id,
        username: row.username,
        selections: Array.isArray(row.selections) ? row.selections : [],
        wildcard: row.wildcard || null,
        submitted: Boolean(row.submitted),
        submitted_at: row.submitted_at || null,
      }));

      setSubmissionRows(rows);
    } finally {
      setSubmissionsLoading(false);
    }
  };

  const loadRaceResults = async () => {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', RACE_RESULTS_SETTING_KEY)
      .maybeSingle();
    if (data?.value && typeof data.value === 'object') {
      setRaceResults(data.value as RaceResultsMap);
    }
  };

  const fetchAndSaveResults = async () => {
    setResultsFetching(true);
    try {
      const marketIds = [...new Set(
        submissionRows.flatMap(row => row.selections.map(s => s.raceId))
      )];
      if (!marketIds.length) return;

      const res = await fetch('/api/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketIds }),
      });
      const data = await res.json() as { results?: { marketId: string; winnerId: string | null; settled: boolean }[]; error?: string };

      if (!res.ok) {
        setError(data.error || 'Failed to fetch results from /api/results.');
        return;
      }

      if (!Array.isArray(data.results)) {
        setError('Unexpected response from /api/results.');
        return;
      }

      setError(null);

      const map: RaceResultsMap = { ...raceResults };
      data.results.forEach(r => {
        if (r.winnerId) {
          let winnerName: string | null = null;
          for (const row of submissionRows) {
            const sel = row.selections.find(s => s.raceId === r.marketId && s.horseId === r.winnerId);
            if (sel) { winnerName = sel.horseName; break; }
          }
          map[r.marketId] = { winnerId: r.winnerId, winnerName };
        }
      });

      const supabase = getSupabaseClient();
      await supabase.from('app_settings').upsert(
        { key: RACE_RESULTS_SETTING_KEY, value: map },
        { onConflict: 'key' }
      );
      setRaceResults(map);

      const settledCount = data.results.filter(r => r.settled).length;
      const winnersCount = data.results.filter(r => r.winnerId).length;
      if (settledCount === 0) {
        setError('No settled markets yet. Try Fetch Results again after races settle.');
      } else if (winnersCount === 0) {
        setError('Markets are settled, but no winners were returned by Betfair data for these market IDs.');
      }
    } finally {
      setResultsFetching(false);
    }
  };

  const applyManualResult = async () => {
    if (!manualResultRaceId || !manualResultHorseId) {
      setError('Choose a race and winning horse before applying manual result.');
      return;
    }

    let winnerName: string | null = null;
    for (const row of submissionRows) {
      const sel = row.selections.find(s => s.raceId === manualResultRaceId && s.horseId === manualResultHorseId);
      if (sel) {
        winnerName = sel.horseName;
        break;
      }
    }

    const map: RaceResultsMap = {
      ...raceResults,
      [manualResultRaceId]: { winnerId: manualResultHorseId, winnerName },
    };

    const supabase = getSupabaseClient();
    const { error: saveError } = await supabase.from('app_settings').upsert(
      { key: RACE_RESULTS_SETTING_KEY, value: map },
      { onConflict: 'key' }
    );

    if (saveError) {
      setError('Unable to save manual result.');
      return;
    }

    setRaceResults(map);
    setError(null);
  };

  const hydrateForUser = async (authUser: User) => {
    const supabase = getSupabaseClient();
    const email = (authUser.email || '').toLowerCase();
    const usernameMeta = typeof authUser.user_metadata?.username === 'string' ? authUser.user_metadata.username : '';
    const username = normalizeUsername(usernameMeta || usernameFromEmail(email));

    setUserId(authUser.id);
    setUser(username);

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert(
        {
          id: authUser.id,
          email,
          username,
        },
        { onConflict: 'id' }
      );

    if (profileError) {
      console.error(profileError);
    }

    const { data: ownProfile, error: ownProfileError } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', authUser.id)
      .maybeSingle();

    if (ownProfileError) {
      console.error(ownProfileError);
    }

    setIsAdmin(Boolean(ownProfile?.is_admin));

    await refreshProfiles();

    const meetsFromDb = await loadGlobalMeetsFromDb();
    setGlobalMeets(meetsFromDb);
    if (meetsFromDb.length) {
      setSelectedMeets(meetsFromDb);
    }

    const { data: existingSubmission, error: submissionError } = await supabase
      .from('user_submissions')
      .select('selections,wildcard,submitted,submitted_at,username')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (submissionError) {
      console.error(submissionError);
    }

    if (existingSubmission) {
      const loadedSelections = Array.isArray(existingSubmission.selections)
        ? (existingSubmission.selections as Selection[])
        : [];
      const loadedWildcard = (existingSubmission.wildcard as Wildcard | null) || null;

      setSelections(loadedSelections);
      setWildcard(loadedWildcard);
      setHasSubmitted(Boolean(existingSubmission.submitted));
      setSubmittedSelections({
        username,
        selections: loadedSelections,
        wildcard: loadedWildcard,
        submitted: Boolean(existingSubmission.submitted),
        submittedAt: existingSubmission.submitted_at || undefined,
      });
    } else {
      clearSelectionState();
    }

    await loadSubmissionRows();
    await loadRaceResults();
  };

  const clearUserState = () => {
    setUser(null);
    setUserId(null);
    setIsAdmin(false);
    setAllUsers({});
    clearSelectionState();
    clearMeetState();
    setSessionNotice(null);
  };

  const login = async () => {
    const normalized = normalizeUsername(authUsername);
    if (!normalized || !authPassword) {
      setAuthError('Username/email and password are required.');
      return;
    }

    const supabase = getSupabaseClient();
    let email = normalized;

    if (!normalized.includes('@')) {
      const { data: profile, error: profileLookupError } = await supabase
        .from('profiles')
        .select('email')
        .eq('username', normalized)
        .maybeSingle();

      if (profileLookupError) {
        setAuthError(profileLookupError.message);
        return;
      }

      if (!profile?.email) {
        setAuthError('No account found for that username.');
        return;
      }

      email = normalizeEmail(profile.email);
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: authPassword,
    });

    if (signInError) {
      setAuthError(signInError.message);
      return;
    }

    setAuthError(null);
    setAuthPassword('');
  };

  const register = async () => {
    const normalized = normalizeUsername(authUsername);
    const normalizedEmail = normalizeEmail(authEmail);
    if (!normalized || !normalizedEmail || !authPassword) {
      setAuthError('Username, email, and password are required.');
      return;
    }

    const supabase = getSupabaseClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: authPassword,
      options: {
        emailRedirectTo: getAuthRedirectUrl(),
        data: {
          username: normalized,
        },
      },
    });

    if (signUpError) {
      setAuthError(signUpError.message);
      return;
    }

    if (!data.session) {
      setAuthError('Account created. Check your inbox to confirm your email before signing in.');
      return;
    }

    setAuthError(null);
    setAuthEmail('');
    setAuthPassword('');
  };

  const logout = async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    clearUserState();
  };

  const toggleAdmin = async (username: string) => {
    const target = allUsers[username];
    if (!target) return;

    const supabase = getSupabaseClient();
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ is_admin: !target.isAdmin })
      .eq('id', target.id);

    if (updateError) {
      console.error(updateError);
      setError('Unable to update admin role. Ensure your SQL policies are applied.');
      return;
    }

    await refreshProfiles();

    if (username === user && userId) {
      const { data: ownProfile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', userId)
        .maybeSingle();
      setIsAdmin(Boolean(ownProfile?.is_admin));
    }
  };

  const resetRaceDayState = async (nextGlobalMeets: Meet[] = []) => {
    const supabase = getSupabaseClient();
    const { error: settingsError } = await supabase
      .from('app_settings')
      .upsert(
        [
          { key: GLOBAL_MEETS_SETTING_KEY, value: nextGlobalMeets },
          { key: RACE_RESULTS_SETTING_KEY, value: {} },
        ],
        { onConflict: 'key' }
      );

    if (settingsError) {
      console.error(settingsError);
      setError('Unable to reset the current race day.');
      return false;
    }

    const { error: submissionsError } = await supabase
      .from('user_submissions')
      .update({
        selections: [],
        wildcard: null,
        submitted: false,
        submitted_at: null,
      })
      .not('user_id', 'is', null);

    if (submissionsError) {
      console.error(submissionsError);
      setError('Race meets were updated, but user selections could not be reset.');
      return false;
    }

    clearSelectionState();
    clearMeetState();
    setGlobalMeets(nextGlobalMeets);
    setSelectedMeets(nextGlobalMeets);
    setSessionNotice(
      nextGlobalMeets.length
        ? 'New meets have been published. Ready to pick horses for the next race day!'
        : 'Meet closed. All selections and results have been cleared. Select two new meets and publish them when ready.'
    );
    setError(null);
    await loadSubmissionRows();
    return true;
  };

  const publishGlobalMeetSelection = async () => {
    if (selectedMeets.length !== 2) {
      setError('Choose exactly two meets before publishing them.');
      return;
    }

    const meetsToPublish = [...selectedMeets];
    const didReset = await resetRaceDayState(meetsToPublish);
    if (!didReset) {
      return;
    }

    for (const meet of meetsToPublish) {
      await loadRacesForMeet(meet);
    }
  };

  const submitSelections = async () => {
    if (!user || !userId) return;

    setIsSubmitting(true);
    try {
      await persistUserSelections(userId, user, selections, wildcard, true);
      setHasSubmitted(true);
      setSubmittedSelections({
        username: user,
        selections,
        wildcard,
        submitted: true,
        submittedAt: new Date().toISOString(),
      });
      await loadSubmissionRows();
      setShowSubmitConfirm(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openSubmitConfirmation = () => {
    if (!canSubmit()) {
      return;
    }
    setShowSubmitConfirm(true);
  };

  const canSubmit = () => {
    if (!globalMeets.length || hasSubmitted) return false;

    const totalRaces = selectedMeets.reduce((sum, meet) => {
      return sum + (races[meet.meet_id] || []).slice(-4).length;
    }, 0);

    return totalRaces > 0 && selections.length >= totalRaces;
  };

  useEffect(() => {
    const supabase = getSupabaseClient();
    let active = true;

    const bootstrap = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        console.error(sessionError);
      }

      if (!active) return;

      if (data.session?.user) {
        await hydrateForUser(data.session.user);
      } else {
        clearUserState();
      }
    };

    void bootstrap();

    const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session?.user) {
        void hydrateForUser(session.user);
      } else {
        clearUserState();
      }
    });

    return () => {
      active = false;
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const date = getTodayDate();

    setLoading(true);
    fetch(`/api/meets?date=${date}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load meets');
        return res.json();
      })
      .then((data) => {
        setMeets(data.meets || []);
      })
      .catch((err) => {
        console.error(err);
        setError('Unable to load meets. Check your API credentials and network.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user && globalMeets.length) {
      setSelectedMeets(globalMeets);
      const loadRacesSequentially = async () => {
        for (const meet of globalMeets) {
          if (!races[meet.meet_id]) {
            await loadRacesForMeet(meet);
          }
        }
      };
      void loadRacesSequentially();
    }
  }, [user, isAdmin, globalMeets]);

  useEffect(() => {
    if (!isAdmin && activeScreen === 'admin') {
      setActiveScreen('main');
    }
  }, [isAdmin, activeScreen]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [activeScreen]);

  useEffect(() => {
    if (!manualResultRaceId || manualRunnersByRaceId[manualResultRaceId]) {
      return;
    }

    let active = true;
    const loadManualRunners = async () => {
      setManualRunnersLoading(true);
      try {
        const res = await fetch(`/api/market-runners?marketId=${encodeURIComponent(manualResultRaceId)}`);
        if (!res.ok) {
          return;
        }

        const data = await res.json() as { runners?: Array<{ id: string; name: string; number: number | null }> };
        const options = Array.isArray(data.runners)
          ? data.runners.map((runner) => ({
              horseId: runner.id,
              horseName: runner.number ? `${runner.number}. ${runner.name}` : runner.name,
            }))
          : [];

        if (!active || !options.length) {
          return;
        }

        setManualRunnersByRaceId(prev => ({ ...prev, [manualResultRaceId]: options }));
      } catch {
        // Keep silent and let existing fallbacks provide options.
      } finally {
        if (active) {
          setManualRunnersLoading(false);
        }
      }
    };

    void loadManualRunners();
    return () => {
      active = false;
    };
  }, [manualResultRaceId, manualRunnersByRaceId]);

  const loadRacesForMeet = async (meet: Meet) => {
    setRaceLoading(prev => ({ ...prev, [meet.meet_id]: true }));

    try {
      const res = await fetch(
        `/api/races?courseId=${encodeURIComponent(meet.meet_id)}&date=${encodeURIComponent(meet.date)}`
      );
      if (!res.ok) {
        throw new Error('Unable to load races');
      }
      const data = await res.json();
      setRaces(prev => ({ ...prev, [meet.meet_id]: data.races || [] }));

      setRaceExpanded(prev => {
        const next = { ...prev };
        (data.races || []).forEach((race: Race) => {
          const key = `${meet.meet_id}|${race.id}`;
          next[key] = true;
        });
        return next;
      });
    } catch (err) {
      console.error('loadRacesForMeet error', err);
      setRaces(prev => ({ ...prev, [meet.meet_id]: [] }));
    } finally {
      setRaceLoading(prev => ({ ...prev, [meet.meet_id]: false }));
    }
  };

  const selectMeet = async (meet: Meet) => {
    if (selectedMeets.length >= 2 || selectedMeets.some(m => m.meet_id === meet.meet_id)) {
      return;
    }

    setSelectedMeets(prev => [...prev, meet]);
    setTimeout(() => {
      document.getElementById('races-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    await loadRacesForMeet(meet);
  };

  const removeSelectedMeet = (meetId: string) => {
    setSelectedMeets((prev) => prev.filter((meet) => meet.meet_id !== meetId));
    setRaces((prev) => {
      const next = { ...prev };
      delete next[meetId];
      return next;
    });
    setRaceLoading((prev) => {
      const next = { ...prev };
      delete next[meetId];
      return next;
    });
    setRaceDebug((prev) => {
      const next = { ...prev };
      delete next[meetId];
      return next;
    });
    setRaceExpanded((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${meetId}|`)) {
          delete next[key];
        }
      });
      return next;
    });
  };

  const loadRaceDebug = async (meet: Meet) => {
    try {
      const res = await fetch(
        `/api/races?courseId=${encodeURIComponent(meet.meet_id)}&date=${encodeURIComponent(meet.date)}&debug=true`
      );
      if (!res.ok) {
        throw new Error('Unable to load debug info');
      }
      const data = await res.json();
      setRaceDebug(prev => ({ ...prev, [meet.meet_id]: data.raw ?? data }));
    } catch (err) {
      console.error(err);
      setError('Unable to load debug info for selected meet.');
    }
  };

  const selectHorse = (meetId: string, raceId: string, raceName: string, horseId: string, horseName: string) => {
    const existing = selections.find(s => s.meetId === meetId && s.raceId === raceId);
    const meetCourse = selectedMeets.find(m => m.meet_id === meetId)?.course ?? meetId;
    const newSelection: Selection = { meetId, meetCourse, raceId, raceName, horseId, horseName };
    const updatedSelections = existing
      ? selections.map(s => (s.meetId === meetId && s.raceId === raceId ? newSelection : s))
      : [...selections, newSelection];

    setSelections(updatedSelections);
    setRaceExpanded(prev => ({ ...prev, [`${meetId}|${raceId}`]: false }));

    if (user && userId && !hasSubmitted) {
      void persistUserSelections(userId, user, updatedSelections, wildcard, false);
    }
  };

  const isSelected = (meetId: string, raceId: string, horseId: string) => {
    return selections.some(s => s.meetId === meetId && s.raceId === raceId && s.horseId === horseId);
  };

  const selectedWildcards = (meetId: string, raceId: string) => {
    return wildcard?.meetId === meetId && wildcard?.raceId === raceId;
  };

  const scoreboard = useMemo(() => {
    if (!Object.keys(raceResults).length || !submissionRows.length) return [];
    return submissionRows
      .filter(row => row.submitted)
      .map(row => {
        let score = 0;
        row.selections.forEach(sel => {
          const result = raceResults[sel.raceId];
          if (result?.winnerId === sel.horseId) {
            const isWild = row.wildcard?.meetId === sel.meetId && row.wildcard?.raceId === sel.raceId;
            score += isWild ? 2 : 1;
          }
        });
        return { username: row.username, score };
      })
      .sort((a, b) => b.score - a.score);
  }, [raceResults, submissionRows]);

  const manualRaceOptions = useMemo(() => {
    const raceMap = new Map<string, { raceName: string; location: string }>();

    selectedMeets.forEach(meet => {
      const location = meet.course ?? meet.meet_id;
      (races[meet.meet_id] || []).forEach(race => {
        if (!raceMap.has(race.id)) {
          raceMap.set(race.id, {
            raceName: race.name,
            location,
          });
        }
      });
    });

    // Fallback for races only seen in submissions (for example, older data that is no longer loaded).
    submissionRows.forEach(row => {
      row.selections.forEach(sel => {
        if (!raceMap.has(sel.raceId)) {
          raceMap.set(sel.raceId, {
            raceName: sel.raceName,
            location: sel.meetCourse ?? selectedMeets.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId,
          });
        }
      });
    });

    return [...raceMap.entries()].map(([raceId, info]) => ({
      raceId,
      label: `${info.location} - ${info.raceName} (${raceId})`,
    }));
  }, [selectedMeets, races, submissionRows]);

  const manualHorseOptions = useMemo(() => {
    if (!manualResultRaceId) return [] as Array<{ horseId: string; horseName: string }>;

    const marketRunners = manualRunnersByRaceId[manualResultRaceId];
    if (marketRunners?.length) {
      return marketRunners;
    }

    const horseMap = new Map<string, string>();

    selectedMeets.forEach(meet => {
      const race = (races[meet.meet_id] || []).find(r => r.id === manualResultRaceId);
      race?.runners.forEach(runner => {
        if (!horseMap.has(runner.id)) {
          horseMap.set(runner.id, runner.name);
        }
      });
    });

    // Fallback to submitted picks if race runners are unavailable.
    if (horseMap.size === 0) {
      submissionRows.forEach(row => {
        row.selections
          .filter(sel => sel.raceId === manualResultRaceId)
          .forEach(sel => {
            if (!horseMap.has(sel.horseId)) {
              horseMap.set(sel.horseId, sel.horseName);
            }
          });
      });
    }

    return [...horseMap.entries()].map(([horseId, horseName]) => ({ horseId, horseName }));
  }, [manualResultRaceId, manualRunnersByRaceId, selectedMeets, races, submissionRows]);

  const rankByUsername = useMemo(() => {
    const map = new Map<string, number>();
    scoreboard.forEach((entry, i) => {
      map.set(entry.username, i + 1);
    });
    return map;
  }, [scoreboard]);

  const podiumTextClass = (rank: number) => {
    if (rank === 1) return 'text-yellow-500';
    if (rank === 2) return 'text-slate-400';
    if (rank === 3) return 'text-amber-700';
    return 'text-slate-500';
  };

  const podiumBadgeClass = (rank: number) => {
    if (rank === 1) return 'bg-yellow-100 text-yellow-700';
    if (rank === 2) return 'bg-slate-100 text-slate-600';
    if (rank === 3) return 'bg-amber-100 text-amber-700';
    return 'bg-blue-100 text-blue-700';
  };

  const wildcardOptions = useMemo(() => selections.map(sel => {
    const course = selectedMeets.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId;
    const race = races[sel.meetId]?.find(r => r.id === sel.raceId);
    const runner = race?.runners.find(r => r.id === sel.horseId);
    const oddsLabel = runner?.odds ? ` - $${runner.odds}` : '';

    return {
      value: `${sel.meetId}|${sel.raceId}`,
      label: `${sel.horseName}${oddsLabel} ; (${sel.raceName} @ ${course})`,
    };
  }), [selections, selectedMeets, races]);

  const getSelectionLocation = (sel: Selection) => {
    return sel.meetCourse ?? selectedMeets.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId;
  };

  const lastRoundRaceResults = useMemo(() => {
    const raceMeta = new Map<string, { raceName: string; location: string }>();
    submissionRows.forEach((row) => {
      row.selections.forEach((sel) => {
        if (!raceMeta.has(sel.raceId)) {
          raceMeta.set(sel.raceId, {
            raceName: sel.raceName,
            location: getSelectionLocation(sel),
          });
        }
      });
    });

    return Object.entries(raceResults).map(([raceId, result]) => {
      const meta = raceMeta.get(raceId);
      return {
        raceId,
        raceName: meta?.raceName || raceId,
        location: meta?.location || 'Unknown Meet',
        winnerName: result.winnerName || result.winnerId,
      };
    });
  }, [raceResults, submissionRows, selectedMeets]);

  const homeContent = (
    <section className="mb-10 space-y-6">
      <div className="rounded-xl bg-gradient-to-r from-sky-600 to-blue-700 p-6 text-white shadow-sm">
        <h2 className="text-2xl font-bold">Welcome {user}</h2>
        <p className="mt-2 text-sm text-blue-100">
          Track the latest round outcomes, review winners, and see points won across all users.
        </p>
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h3 className="text-lg font-semibold">Last Round Points Won</h3>
        {scoreboard.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No scored results yet for the current round.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {scoreboard.map((entry, i) => (
              <li key={`home-score-${entry.username}`} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium">{i + 1}. {entry.username}</span>
                <span className="font-semibold text-slate-700">{entry.score} pt{entry.score !== 1 ? 's' : ''}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h3 className="text-lg font-semibold">Last Round Results</h3>
        {lastRoundRaceResults.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Race results are not available yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {lastRoundRaceResults.map((result) => (
              <li key={`home-result-${result.raceId}`} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium">{result.location} - {result.raceName}</span>
                <span className="ml-2 text-slate-700">Winner: {result.winnerName || 'TBC'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );

  const submitConfirmationModal = showSubmitConfirm ? (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto">
        <h3 className="text-lg font-semibold mb-2">Confirm Your Selections</h3>
        <p className="text-sm text-slate-600 mb-4">
          You are about to submit {selections.length} selection{selections.length === 1 ? '' : 's'}. You will not be able to edit after submitting.
        </p>

        <ul className="space-y-2 mb-4">
          {selections.map(sel => (
            <li key={`confirm-${sel.meetId}-${sel.raceId}`} className="rounded-lg bg-slate-50 p-3 text-sm">
              <span className="font-medium">{selectedMeets.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId}</span> Race {sel.raceId}: {sel.horseName}{' '}
              {wildcard?.meetId === sel.meetId && wildcard?.raceId === sel.raceId ? (
                <span className="text-sm font-semibold text-emerald-600">(Wildcard)</span>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="flex gap-3">
          <button
            onClick={() => {
              void submitSelections();
            }}
            disabled={isSubmitting}
            className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? 'Submitting...' : 'Confirm and Submit'}
          </button>
          <button
            onClick={() => setShowSubmitConfirm(false)}
            disabled={isSubmitting}
            className="flex-1 rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const submissionsContent = (
    <section className="mb-10">
      {isAdmin ? (
        <div className="mb-4 flex flex-col gap-2 lg:items-end">
          <button
            onClick={() => { void fetchAndSaveResults(); }}
            disabled={resultsFetching || submissionRows.length === 0}
            className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {resultsFetching ? 'Fetching...' : 'Fetch Results'}
          </button>
          <div className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm lg:flex-row lg:items-center">
            <select
              value={manualResultRaceId}
              onChange={(e) => {
                setManualResultRaceId(e.target.value);
                setManualResultHorseId('');
              }}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Select race</option>
              {manualRaceOptions.map(opt => (
                <option key={opt.raceId} value={opt.raceId}>{opt.label}</option>
              ))}
            </select>
            <select
              value={manualResultHorseId}
              onChange={(e) => setManualResultHorseId(e.target.value)}
              disabled={!manualResultRaceId || manualRunnersLoading}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="">{manualRunnersLoading ? 'Loading horses...' : 'Select winning horse'}</option>
              {manualHorseOptions.map(opt => (
                <option key={opt.horseId} value={opt.horseId}>{opt.horseName}</option>
              ))}
            </select>
            <button
              onClick={() => { void applyManualResult(); }}
              disabled={!manualResultRaceId || !manualResultHorseId}
              className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Apply Manual Winner
            </button>
          </div>
        </div>
      ) : null}
      {scoreboard.length > 0 ? (
        <div className="mb-6 rounded-lg bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">\ud83c\udfc6 Leaderboard</h3>
          <ol className="space-y-1">
            {scoreboard.map((entry, i) => (
              <li key={entry.username} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className={`w-5 text-center font-bold ${podiumTextClass(i + 1)}`}>{i + 1}</span>
                  <span className="font-medium">{entry.username}</span>
                </span>
                <span className={`font-bold ${podiumTextClass(i + 1)}`}>{entry.score} pt{entry.score !== 1 ? 's' : ''}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {submissionsLoading ? (
        <div className="rounded-lg bg-white p-4 shadow-sm text-sm text-slate-500">Loading submissions...</div>
      ) : submissionRows.length === 0 ? (
        <div className="rounded-lg bg-white p-4 shadow-sm text-sm text-slate-500">No submissions found yet.</div>
      ) : (
        <div className="space-y-3">
          {submissionRows.map(row => {
            const rowScore = scoreboard.find(e => e.username === row.username)?.score ?? null;
            const rowRank = rankByUsername.get(row.username) ?? 0;
            const submittedAtLabel = row.submitted_at ? new Date(row.submitted_at).toLocaleString() : 'Not submitted yet';
            return (
              <details key={row.user_id} className="group rounded-lg bg-white shadow-sm" open={row.username === user}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-semibold">{row.username}</p>
                    <p className="mt-1 text-xs text-slate-500">{submittedAtLabel}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {rowScore !== null ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${podiumBadgeClass(rowRank)}`}>{rowScore} pt{rowScore !== 1 ? 's' : ''}</span>
                    ) : null}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.submitted ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {row.submitted ? 'Submitted' : 'Not Submitted'}
                    </span>
                    <span className="text-xs text-slate-400 transition group-open:rotate-180">▼</span>
                  </div>
                </summary>

                <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                  {row.selections.length === 0 ? (
                    <p className="text-sm text-slate-500">No selections yet.</p>
                  ) : (
                    <ul className="space-y-1 text-sm text-slate-700">
                      {row.selections.map((sel, idx) => {
                        const isWildcard = row.wildcard?.meetId === sel.meetId && row.wildcard?.raceId === sel.raceId;
                        const result = raceResults[sel.raceId];
                        const isWinner = result?.winnerId === sel.horseId;
                        return (
                          <li key={`${row.user_id}-${sel.meetId}-${sel.raceId}-${idx}`} className={`rounded px-2 py-0.5 ${isWinner ? 'bg-green-100 text-green-900 font-semibold' : isWildcard ? 'bg-yellow-100 text-yellow-900 font-semibold' : ''}`}>
                            {getSelectionLocation(sel)} - {sel.raceName}: {sel.horseName}
                            {isWildcard ? ' \u2b50 Wildcard' : ''}
                            {isWinner ? ' \u2705' : (result && !isWinner ? ' \u274c' : '')}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 p-6 flex items-center justify-center">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
          <h1 className="text-2xl font-bold mb-2">Braddo's Horse Punting</h1>
          <p className="text-sm text-slate-500 mb-6">
            Sign in or create an account to start selecting horses.
          </p>

          <div className="flex gap-2 mb-5">
            <button
              onClick={() => {
                setAuthMode('login');
                setAuthError(null);
              }}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
                authMode === 'login' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => {
                setAuthMode('register');
                setAuthError(null);
              }}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
                authMode === 'register' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              Create Account
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Username or Email</label>
              <input
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            {authMode === 'register' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>
            ) : null}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Password</label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>

          {authError ? (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {authError}
            </div>
          ) : null}

          <button
            onClick={() => {
              if (authMode === 'login') {
                void login();
              } else {
                void register();
              }
            }}
            className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {authMode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </div>
      </div>
    );
  }

  if (user && isAdmin) {
    const usersList = Object.entries(allUsers);
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        {/* Mobile sticky top bar */}
        <header className="sticky top-0 z-20 bg-white border-b border-slate-200 flex items-center justify-between px-4 py-3 lg:hidden">
          <span className="font-bold text-base">🏇 Braddo&apos;s Punting</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 max-w-[110px] truncate">{user}</span>
            <button onClick={() => { void logout(); }} className="rounded-lg bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-200">Log out</button>
          </div>
        </header>
        <div className="lg:flex lg:gap-6 lg:max-w-6xl lg:mx-auto lg:p-6">
          <aside
            className={`hidden lg:flex lg:flex-col lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:shrink-0 lg:rounded-xl lg:bg-white lg:p-4 lg:shadow-sm ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'}`}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className={`text-sm font-semibold text-slate-700 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>Navigation</h2>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(prev => !prev)}
                className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
              >
                {sidebarCollapsed ? '→' : '←'}
              </button>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => setActiveScreen('home')}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${activeScreen === 'home' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} ${sidebarCollapsed ? 'lg:text-center' : ''}`}
              >
                <span className={sidebarCollapsed ? 'lg:hidden' : ''}>Home</span>
                <span className={`hidden ${sidebarCollapsed ? 'lg:inline' : ''}`}>H</span>
              </button>
              <button
                onClick={() => setActiveScreen('main')}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${activeScreen === 'main' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} ${sidebarCollapsed ? 'lg:text-center' : ''}`}
              >
                <span className={sidebarCollapsed ? 'lg:hidden' : ''}>My Picks</span>
                <span className={`hidden ${sidebarCollapsed ? 'lg:inline' : ''}`}>M</span>
              </button>
              <button
                onClick={() => setActiveScreen('admin')}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${activeScreen === 'admin' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} ${sidebarCollapsed ? 'lg:text-center' : ''}`}
              >
                <span className={sidebarCollapsed ? 'lg:hidden' : ''}>Admin</span>
                <span className={`hidden ${sidebarCollapsed ? 'lg:inline' : ''}`}>A</span>
              </button>
              <button
                onClick={() => setActiveScreen('submissions')}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${activeScreen === 'submissions' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} ${sidebarCollapsed ? 'lg:text-center' : ''}`}
              >
                <span className={sidebarCollapsed ? 'lg:hidden' : ''}>User Submissions</span>
                <span className={`hidden ${sidebarCollapsed ? 'lg:inline' : ''}`}>U</span>
              </button>
            </div>
          </aside>

          <div className="flex-1 px-4 py-4 pb-24 lg:px-0 lg:py-0 lg:pb-0">
          {/* Desktop header */}
          <header className="mb-8 hidden lg:flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold">
                {activeScreen === 'home' && 'Home'}
                {activeScreen === 'main' && 'My Picks'}
                {activeScreen === 'admin' && 'Admin'}
                {activeScreen === 'submissions' && 'User Submissions'}
              </h1>
              <p className="mt-2 text-slate-600">
                {activeScreen === 'home' && 'Welcome and round summary.'}
                {activeScreen === 'main' && 'Pick horses and submit selections.'}
                {activeScreen === 'admin' && 'Manage global meets and user permissions.'}
                {activeScreen === 'submissions' && 'Review all user submissions.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-700">Signed in as <strong>{user}</strong></span>
              <button
                onClick={() => { void logout(); }}
                className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
              >
                Log out
              </button>
            </div>
          </header>
          {/* Mobile page title */}
          <div className="mb-5 lg:hidden">
            <h1 className="text-2xl font-bold">
              {activeScreen === 'home' && 'Home'}
              {activeScreen === 'main' && 'My Picks'}
              {activeScreen === 'admin' && 'Admin'}
              {activeScreen === 'submissions' && 'User Submissions'}
            </h1>
          </div>

          {error ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
          ) : null}

          {sessionNotice ? (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
              {sessionNotice}
            </div>
          ) : null}

          {activeScreen === 'home' ? homeContent : null}

          <section className={`mb-10 ${activeScreen === 'admin' ? '' : 'hidden'}`}>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Global Meet Selection</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    void resetRaceDayState([]);
                  }}
                  className="rounded-full bg-red-100 px-4 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-200"
                >
                  Close Meet &amp; Start New Day
                </button>
                <button
                  onClick={() => {
                    void publishGlobalMeetSelection();
                  }}
                  disabled={selectedMeets.length !== 2}
                  className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Publish Meets for New Day
                </button>
              </div>
            </div>

            <p className="mt-2 text-sm text-slate-500">
              Races, runners, and user picks remain visible after a race day ends so you can assign results and view the scoreboard.
              When you are ready to start the next race day, click <strong>Close Meet &amp; Start New Day</strong> — this clears all selections and results.
              Then select two new meets and click <strong>Publish Meets for New Day</strong>.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {meets.map(meet => {
                const isSelectedMeet = selectedMeets.some(m => m.meet_id === meet.meet_id);
                return (
                  <div
                    key={meet.meet_id}
                    className={`p-4 rounded-lg shadow-sm ${
                      isSelectedMeet ? 'bg-emerald-50 border border-emerald-200' : 'bg-white'
                    }`}
                  >
                    <h3 className="text-lg font-semibold">{meet.course} ({meet.state})</h3>
                    <p className="text-sm text-slate-500">{meet.date}</p>
                    <button
                      onClick={() => {
                        if (isSelectedMeet) {
                          removeSelectedMeet(meet.meet_id);
                          return;
                        }

                        void selectMeet(meet);
                      }}
                      disabled={selectedMeets.length >= 2 && !isSelectedMeet}
                      className={`mt-4 inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium shadow-sm transition ${
                        isSelectedMeet
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      } disabled:cursor-not-allowed disabled:bg-slate-300`}
                    >
                      {isSelectedMeet ? 'Remove' : 'Select'}
                    </button>
                  </div>
                );
              })}
            </div>

            {globalMeets.length ? (
              <div className="mt-6 rounded-lg bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-700">Current Global Meets</h3>
                <ul className="mt-2 text-sm text-slate-600">
                  {globalMeets.map(m => (
                    <li key={m.meet_id}>{m.course} ({m.date})</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className={`mb-10 ${activeScreen === 'admin' ? '' : 'hidden'}`}>
            <h2 className="text-xl font-semibold mb-3">User Management</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {usersList.map(([username, record]) => (
                <div key={username} className="rounded-lg bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{username}</p>
                      <p className="text-xs text-slate-500">{record.isAdmin ? 'Admin' : 'User'} • {record.email}</p>
                    </div>
                    <button
                      onClick={() => {
                        void toggleAdmin(username);
                      }}
                      className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300"
                    >
                      {record.isAdmin ? 'Revoke Admin' : 'Make Admin'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {activeScreen === 'main' && globalMeets.length > 0 && (
            <section className="mb-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">My Horse Selections</h2>
                {hasSubmitted ? (
                  <span className="text-sm text-green-600 font-medium">Submitted</span>
                ) : (
                  <button
                    onClick={openSubmitConfirmation}
                    disabled={!canSubmit() || isSubmitting}
                    className="rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {canSubmit() ? 'Review and Submit' : 'Complete all race picks to submit'}
                  </button>
                )}
              </div>

              {hasSubmitted && submittedSelections ? (
                <div className="rounded-lg bg-green-50 border border-green-200 p-4 mb-6">
                  <h3 className="text-sm font-semibold text-green-800 mb-2">Selections Submitted</h3>
                  <p className="text-sm text-green-700">
                    Submitted {submittedSelections.selections.length} selections
                    {submittedSelections.wildcard && ' with wildcard'}
                    {submittedSelections.submittedAt && ` on ${new Date(submittedSelections.submittedAt).toLocaleString()}`}
                  </p>
                </div>
              ) : null}

              <div id="races-section">
                {selectedMeets.map(meet => (
                  <div key={meet.meet_id} className="mb-10">
                    <h3 className="text-lg font-semibold mb-3">{meet.course} - Last 4 Races</h3>
                    {raceLoading[meet.meet_id] ? (
                      <div className="rounded-lg bg-white p-4 shadow-sm">
                        <p className="text-sm text-slate-500">Loading races...</p>
                      </div>
                    ) : (races[meet.meet_id] || []).length === 0 ? (
                      <div className="rounded-lg bg-white p-6 shadow-sm">
                        <p className="text-sm text-slate-600">No races were found for this meet.</p>
                      </div>
                    ) : (
                      <div className="-mx-4 px-4 lg:mx-0 lg:px-0">
                      <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory lg:grid lg:grid-cols-4 lg:overflow-visible lg:snap-none">
                        {(races[meet.meet_id] || []).slice(-4).map(race => {
                          const raceKey = `${meet.meet_id}|${race.id}`;
                          const selected = selections.find(s => s.meetId === meet.meet_id && s.raceId === race.id);
                          const expanded = raceExpanded[raceKey] ?? true;
                          const selectedRunner = selected ? race.runners.find(r => r.id === selected.horseId) : null;

                          return (
                            <div key={race.id} className="bg-white p-4 rounded-lg shadow-sm shrink-0 w-[82vw] sm:w-80 snap-start lg:w-auto lg:shrink">
                              <div className="flex items-center justify-between">
                                <div>
                                  <h3 className="text-lg font-semibold">{race.name}</h3>
                                  <p className="text-xs text-slate-500">{formatRaceTime(race.time)}</p>
                                </div>
                                {selected ? (
                                  <button
                                    type="button"
                                    onClick={() => setRaceExpanded(prev => ({ ...prev, [raceKey]: true }))}
                                    className="text-xs font-medium text-blue-600 hover:underline"
                                  >
                                    Change
                                  </button>
                                ) : null}
                              </div>

                              {selected && !expanded && selectedRunner ? (
                                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                                  <p className="text-sm font-medium">Selected: {selectedRunner.name}</p>
                                  <p className="text-xs text-slate-500">Odds: {selectedRunner.odds || 'N/A'}</p>
                                </div>
                              ) : (
                                <ul className="mt-3 space-y-2">
                                  {race.runners.map(runner => (
                                    <li key={runner.id}>
                                      <button
                                        onClick={() => {
                                          setSelectedRunnerDetails({ runner, meetId: meet.meet_id, raceId: race.id, raceName: race.name });
                                        }}
                                        className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                                          isSelected(meet.meet_id, race.id, runner.id)
                                            ? 'bg-green-100 text-green-900'
                                            : 'bg-slate-50 text-slate-900 hover:bg-slate-100'
                                        } ${
                                          selectedWildcards(meet.meet_id, race.id)
                                            ? 'ring-2 ring-amber-400'
                                            : ''
                                        }`}
                                      >
                                        {runner.name}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3">Select Wildcard Horse</h3>
                <select
                  value={wildcard ? `${wildcard.meetId}|${wildcard.raceId}` : ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (!value) {
                      setWildcard(null);
                      if (user && userId && !hasSubmitted) {
                        void persistUserSelections(userId, user, selections, null, false);
                      }
                      return;
                    }
                    const [meetId, raceId] = value.split('|');
                    const sel = selections.find(s => s.meetId === meetId && s.raceId === raceId);
                    if (!sel) return;
                    const nextWildcard = { meetId, raceId };
                    setWildcard(nextWildcard);
                    if (user && userId && !hasSubmitted) {
                      void persistUserSelections(userId, user, selections, nextWildcard, false);
                    }
                  }}
                  className="w-full max-w-xs rounded border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
                >
                  <option value="">Choose Wildcard</option>
                  {wildcardOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-sm text-slate-500">
                  The wildcard can only be assigned to one race; it will double the points for that race.
                </p>
              </div>

              <section>
                <h3 className="text-lg font-semibold mb-3">Your Selections</h3>
                <ul className="space-y-2">
                  {selections.length === 0 ? (
                    <li className="text-sm text-slate-500">No selections yet.</li>
                  ) : (
                    selections.map(sel => (
                      <li key={`${sel.meetId}-${sel.raceId}`} className="rounded-lg bg-white p-3 shadow-sm">
                        <span className="font-medium">{selectedMeets.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId}</span> Race {sel.raceId}: {sel.horseName}{' '}
                        {wildcard?.meetId === sel.meetId && wildcard?.raceId === sel.raceId ? (
                          <span className="text-sm font-semibold text-emerald-600">(Wildcard)</span>
                        ) : null}
                      </li>
                    ))
                  )}
                </ul>
              </section>
            </section>
          )}

          {activeScreen === 'submissions' ? submissionsContent : null}

          {activeScreen === 'main' ? submitConfirmationModal : null}

          {activeScreen === 'main' && selectedRunnerDetails && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                <h3 className="text-lg font-semibold mb-4">{selectedRunnerDetails.runner.name}</h3>
                <div className="space-y-2 text-sm">
                  <p><strong>Jockey:</strong> {selectedRunnerDetails.runner.jockey || 'N/A'}</p>
                  <p><strong>Colours:</strong> {selectedRunnerDetails.runner.colours || 'N/A'}</p>
                  <p><strong>Weight:</strong> {selectedRunnerDetails.runner.weight || 'N/A'}</p>
                  <p><strong>Age:</strong> {selectedRunnerDetails.runner.age || 'N/A'}</p>
                  <p><strong>Odds:</strong> {selectedRunnerDetails.runner.odds || 'N/A'}</p>
                  <p><strong>Trainer:</strong> {selectedRunnerDetails.runner.trainer || 'N/A'}</p>
                  <p><strong>Form:</strong> {selectedRunnerDetails.runner.form || 'N/A'}</p>
                </div>
                <div className="mt-6 flex space-x-3">
                  <button
                    onClick={() => {
                      selectHorse(
                        selectedRunnerDetails.meetId,
                        selectedRunnerDetails.raceId,
                        selectedRunnerDetails.raceName,
                        selectedRunnerDetails.runner.id,
                        selectedRunnerDetails.runner.name
                      );
                      setSelectedRunnerDetails(null);
                    }}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                  >
                    Select Horse
                  </button>
                  <button
                    onClick={() => setSelectedRunnerDetails(null)}
                    className="flex-1 bg-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-400"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
        {/* Mobile bottom tab bar */}
        <nav className="fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 flex lg:hidden">
          <button onClick={() => setActiveScreen('home')} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${activeScreen === 'home' ? 'text-blue-600' : 'text-slate-500'}`}>
            <span className="text-xl leading-none">🏠</span>
            <span>Home</span>
          </button>
          <button onClick={() => setActiveScreen('main')} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${activeScreen === 'main' ? 'text-blue-600' : 'text-slate-500'}`}>
            <span className="text-xl leading-none">🏇</span>
            <span>Picks</span>
          </button>
          <button onClick={() => setActiveScreen('submissions')} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${activeScreen === 'submissions' ? 'text-blue-600' : 'text-slate-500'}`}>
            <span className="text-xl leading-none">📋</span>
            <span>Submissions</span>
          </button>
          <button onClick={() => setActiveScreen('admin')} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${activeScreen === 'admin' ? 'text-blue-600' : 'text-slate-500'}`}>
            <span className="text-xl leading-none">⚙️</span>
            <span>Admin</span>
          </button>
        </nav>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Mobile sticky top bar */}
      <div className="sticky top-0 z-20 flex items-center justify-between bg-white px-4 py-3 shadow-sm lg:hidden">
        <span className="text-base font-bold tracking-tight">🏇 Braddo&apos;s Punting</span>
        <div className="flex items-center gap-2">
          <span className="max-w-[110px] truncate text-xs text-slate-500">{user}</span>
          <button
            onClick={() => { void logout(); }}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
          >
            Log out
          </button>
        </div>
      </div>
      <div className="lg:flex lg:gap-6 lg:max-w-6xl lg:mx-auto lg:p-6">
        <aside
          className={`hidden lg:flex lg:flex-col lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:shrink-0 lg:rounded-xl lg:bg-white lg:p-4 lg:shadow-sm ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'}`}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className={`text-sm font-semibold text-slate-700 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>Navigation</h2>
            <button
              type="button"
              onClick={() => setSidebarCollapsed(prev => !prev)}
              className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
            >
              {sidebarCollapsed ? '→' : '←'}
            </button>
          </div>
          <div className="space-y-2">
            <button
              onClick={() => setActiveScreen('home')}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${activeScreen === 'home' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} ${sidebarCollapsed ? 'lg:text-center' : ''}`}
            >
              <span className={sidebarCollapsed ? 'lg:hidden' : ''}>Home</span>
              <span className={`hidden ${sidebarCollapsed ? 'lg:inline' : ''}`}>H</span>
            </button>
            <button
              onClick={() => setActiveScreen('main')}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${activeScreen === 'main' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} ${sidebarCollapsed ? 'lg:text-center' : ''}`}
            >
              <span className={sidebarCollapsed ? 'lg:hidden' : ''}>My Picks</span>
              <span className={`hidden ${sidebarCollapsed ? 'lg:inline' : ''}`}>M</span>
            </button>
            <button
              onClick={() => setActiveScreen('submissions')}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${activeScreen === 'submissions' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} ${sidebarCollapsed ? 'lg:text-center' : ''}`}
            >
              <span className={sidebarCollapsed ? 'lg:hidden' : ''}>User Submissions</span>
              <span className={`hidden ${sidebarCollapsed ? 'lg:inline' : ''}`}>U</span>
            </button>
          </div>
        </aside>

        <div className="flex-1 px-4 py-4 pb-24 lg:px-0 lg:py-0 lg:pb-0">
        <header className="mb-8 hidden lg:flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">
              {activeScreen === 'home' ? 'Home' : activeScreen === 'main' ? 'My Picks' : 'User Submissions'}
            </h1>
            <p className="mt-2 text-slate-600">
              {activeScreen === 'home'
                ? 'Welcome and round summary.'
                : activeScreen === 'main'
                ? 'Pick one horse per race in the last four races of two selected meets for tomorrow, then choose a wildcard horse for double points.'
                : 'Review all user submissions.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-700">Signed in as <strong>{user}</strong></span>
            <button
              onClick={() => { void logout(); }}
              className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
            >
              Log out
            </button>
          </div>
        </header>
        <div className="mb-5 lg:hidden">
          <h1 className="text-2xl font-bold">
            {activeScreen === 'home' ? 'Home' : activeScreen === 'main' ? 'My Picks' : 'User Submissions'}
          </h1>
        </div>

        {error ? (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{error}</div>
        ) : null}

        {sessionNotice ? (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            {sessionNotice}
          </div>
        ) : null}

        {activeScreen === 'home' ? homeContent : null}

        {activeScreen === 'main' ? (
        <>
        <div className="mb-8">
          <h2 className="text-xl font-semibold">Global Meets</h2>

          {globalMeets.length === 0 ? (
            <div className="mt-4 rounded-lg bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">Waiting for an admin to select the two race meets for this session.</p>
              <p className="mt-2 text-sm text-slate-500">Once an admin has chosen the meets, they will appear here automatically.</p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {globalMeets.map(meet => (
                <div key={meet.meet_id} className="bg-white p-4 rounded-lg shadow-sm">
                  <h3 className="text-lg font-semibold">{meet.course} ({meet.state})</h3>
                  <p className="text-sm text-slate-500">{meet.date}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div id="races-section">
          {selectedMeets.map(meet => (
            <div key={meet.meet_id} className="mb-10">
              <h2 className="text-xl font-semibold mb-3">{meet.course} - Last 4 Races</h2>
              {raceLoading[meet.meet_id] ? (
                <div className="rounded-lg bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-500">Loading races...</p>
                </div>
              ) : (races[meet.meet_id] || []).length === 0 ? (
                <div className="rounded-lg bg-white p-6 shadow-sm">
                  <p className="text-sm text-slate-600">
                    No races were found for this meet. This can happen if the API returned no racecards for the selected course or if the course ID format differs from what the API expects.
                  </p>
                  <p className="mt-3 text-sm text-slate-500">Try selecting a different meet or enabling mock mode (set USE_MOCK_DATA=true in .env.local).</p>
                  <button
                    onClick={() => {
                      void loadRaceDebug(meet);
                    }}
                    className="mt-4 inline-flex items-center justify-center rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-amber-600"
                  >
                    Show API Response (Debug)
                  </button>
                  {raceDebug[meet.meet_id] ? (
                    <pre className="mt-4 max-h-64 overflow-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs">
                      {JSON.stringify(raceDebug[meet.meet_id], null, 2)}
                    </pre>
                  ) : null}
                </div>
              ) : (
                <div className="-mx-4 px-4 lg:mx-0 lg:px-0">
                <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory lg:grid lg:grid-cols-4 lg:overflow-visible lg:snap-none">
                  {(races[meet.meet_id] || []).slice(-4).map(race => {
                    const raceKey = `${meet.meet_id}|${race.id}`;
                    const selected = selections.find(s => s.meetId === meet.meet_id && s.raceId === race.id);
                    const expanded = raceExpanded[raceKey] ?? true;
                    const selectedRunner = selected ? race.runners.find(r => r.id === selected.horseId) : null;

                    return (
                      <div key={race.id} className="shrink-0 w-[82vw] sm:w-80 snap-start lg:w-auto lg:shrink bg-white p-4 rounded-lg shadow-sm">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-lg font-semibold">{race.name}</h3>
                            <p className="text-xs text-slate-500">{formatRaceTime(race.time)}</p>
                          </div>
                          {selected ? (
                            <button
                              type="button"
                              onClick={() => setRaceExpanded(prev => ({ ...prev, [raceKey]: true }))}
                              className="text-xs font-medium text-blue-600 hover:underline"
                            >
                              Change
                            </button>
                          ) : null}
                        </div>

                        {selected && !expanded && selectedRunner ? (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <p className="text-sm font-medium">Selected: {selectedRunner.name}</p>
                            <p className="text-xs text-slate-500">Odds: {selectedRunner.odds || 'N/A'}</p>
                          </div>
                        ) : (
                          <ul className="mt-3 space-y-2">
                            {race.runners.map(runner => (
                              <li key={runner.id}>
                                <button
                                  onClick={() => {
                                    setSelectedRunnerDetails({ runner, meetId: meet.meet_id, raceId: race.id, raceName: race.name });
                                  }}
                                  className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                                    isSelected(meet.meet_id, race.id, runner.id)
                                      ? 'bg-green-100 text-green-900'
                                      : 'bg-slate-50 text-slate-900 hover:bg-slate-100'
                                  } ${selectedWildcards(meet.meet_id, race.id) ? 'ring-2 ring-amber-400' : ''}`}
                                >
                                  {runner.name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Select Wildcard Horse</h2>
          <select
            value={wildcard ? `${wildcard.meetId}|${wildcard.raceId}` : ''}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) {
                setWildcard(null);
                if (user && userId && !hasSubmitted) {
                  void persistUserSelections(userId, user, selections, null, false);
                }
                return;
              }
              const [meetId, raceId] = value.split('|');
              const sel = selections.find(s => s.meetId === meetId && s.raceId === raceId);
              if (!sel) return;
              const nextWildcard = { meetId, raceId };
              setWildcard(nextWildcard);
              if (user && userId && !hasSubmitted) {
                void persistUserSelections(userId, user, selections, nextWildcard, false);
              }
            }}
            className="w-full max-w-xs rounded border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="">Choose Wildcard</option>
            {wildcardOptions.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-slate-500">The wildcard can only be assigned to one race; it will double the points for that race.</p>
        </div>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Your Selections</h2>
          <ul className="space-y-2">
            {selections.length === 0 ? (
              <li className="text-sm text-slate-500">No selections yet.</li>
            ) : (
              selections.map(sel => (
                <li key={`${sel.meetId}-${sel.raceId}`} className="rounded-lg bg-white p-3 shadow-sm">
                  <span className="font-medium">{selectedMeets.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId}</span> Race {sel.raceId}: {sel.horseName}{' '}
                  {wildcard?.meetId === sel.meetId && wildcard?.raceId === sel.raceId ? (
                    <span className="text-sm font-semibold text-emerald-600">(Wildcard)</span>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </section>

        {globalMeets.length > 0 && (
          <div className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">My Horse Selections</h2>
              {hasSubmitted ? (
                <span className="text-sm text-green-600 font-medium">Submitted</span>
              ) : (
                <button
                  onClick={openSubmitConfirmation}
                  disabled={!canSubmit() || isSubmitting}
                  className="rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {canSubmit() ? 'Review and Submit' : 'Complete all race picks to submit'}
                </button>
              )}
            </div>

            {hasSubmitted && submittedSelections ? (
              <div className="rounded-lg bg-green-50 border border-green-200 p-4 mb-6">
                <h3 className="text-sm font-semibold text-green-800 mb-2">Selections Submitted</h3>
                <p className="text-sm text-green-700">
                  Submitted {submittedSelections.selections.length} selections
                  {submittedSelections.wildcard && ' with wildcard'}
                  {submittedSelections.submittedAt && ` on ${new Date(submittedSelections.submittedAt).toLocaleString()}`}
                </p>
              </div>
            ) : null}
          </div>
        )}

        {submitConfirmationModal}
        </>
        ) : null}

          {activeScreen === 'submissions' ? submissionsContent : null}



        {/* Bottom tab nav — mobile only */}
        <nav className="fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 flex lg:hidden">
          <button
            onClick={() => setActiveScreen('home')}
            className={`flex-1 py-3 flex flex-col items-center gap-0.5 text-xs font-medium ${
              activeScreen === 'home' ? 'text-blue-600' : 'text-slate-500'
            }`}
          >
            <span className="text-lg">🏠</span>
            <span>Home</span>
          </button>
          <button
            onClick={() => setActiveScreen('main')}
            className={`flex-1 py-3 flex flex-col items-center gap-0.5 text-xs font-medium ${
              activeScreen === 'main' ? 'text-blue-600' : 'text-slate-500'
            }`}
          >
            <span className="text-lg">🏇</span>
            <span>Picks</span>
          </button>
          <button
            onClick={() => setActiveScreen('submissions')}
            className={`flex-1 py-3 flex flex-col items-center gap-0.5 text-xs font-medium ${
              activeScreen === 'submissions' ? 'text-blue-600' : 'text-slate-500'
            }`}
          >
            <span className="text-lg">📋</span>
            <span>Submissions</span>
          </button>
        </nav>

        {activeScreen === 'main' && selectedRunnerDetails && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">{selectedRunnerDetails.runner.name}</h3>
              <div className="space-y-2 text-sm">
                <p><strong>Jockey:</strong> {selectedRunnerDetails.runner.jockey || 'N/A'}</p>
                <p><strong>Colours:</strong> {selectedRunnerDetails.runner.colours || 'N/A'}</p>
                <p><strong>Weight:</strong> {selectedRunnerDetails.runner.weight || 'N/A'}</p>
                <p><strong>Age:</strong> {selectedRunnerDetails.runner.age || 'N/A'}</p>
                <p><strong>Odds:</strong> {selectedRunnerDetails.runner.odds || 'N/A'}</p>
                <p><strong>Trainer:</strong> {selectedRunnerDetails.runner.trainer || 'N/A'}</p>
                <p><strong>Form:</strong> {selectedRunnerDetails.runner.form || 'N/A'}</p>
              </div>
              <div className="mt-6 flex space-x-3">
                <button
                  onClick={() => {
                    selectHorse(
                      selectedRunnerDetails.meetId,
                      selectedRunnerDetails.raceId,
                      selectedRunnerDetails.raceName,
                      selectedRunnerDetails.runner.id,
                      selectedRunnerDetails.runner.name
                    );
                    setSelectedRunnerDetails(null);
                  }}
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                  Select Horse
                </button>
                <button
                  onClick={() => setSelectedRunnerDetails(null)}
                  className="flex-1 bg-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-400"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        </div>
      </div>
    </div>
  );
}

