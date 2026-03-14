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

const GLOBAL_MEETS_SETTING_KEY = 'global_meets';

const normalizeUsername = (value: string) => value.trim().toLowerCase();
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const usernameFromEmail = (email: string) => email.split('@')[0] || email;
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

  const saveGlobalMeetsToDb = async (meetsToSave: Meet[]) => {
    const supabase = getSupabaseClient();
    const { error: upsertError } = await supabase
      .from('app_settings')
      .upsert({ key: GLOBAL_MEETS_SETTING_KEY, value: meetsToSave }, { onConflict: 'key' });

    if (upsertError) {
      console.error(upsertError);
      setError('Unable to save global meets.');
      return;
    }

    setGlobalMeets(meetsToSave);
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

      setSelections(loadedSelections);
      setWildcard((existingSubmission.wildcard as Wildcard | null) || null);
      setHasSubmitted(Boolean(existingSubmission.submitted));
      setSubmittedSelections({
        username,
        selections: loadedSelections,
        wildcard: (existingSubmission.wildcard as Wildcard | null) || null,
        submitted: Boolean(existingSubmission.submitted),
        submittedAt: existingSubmission.submitted_at || undefined,
      });
    } else {
      setSelections([]);
      setWildcard(null);
      setHasSubmitted(false);
      setSubmittedSelections(null);
    }
  };

  const clearUserState = () => {
    setUser(null);
    setUserId(null);
    setIsAdmin(false);
    setAllUsers({});
    setSelections([]);
    setWildcard(null);
    setSelectedMeets([]);
    setRaces({});
    setRaceExpanded({});
    setSubmittedSelections(null);
    setHasSubmitted(false);
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

  const setGlobalMeetSelection = async (meetsToSet: Meet[]) => {
    await saveGlobalMeetsToDb(meetsToSet);
    setSelectedMeets(meetsToSet);
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

    const requiredRaces = globalMeets.length * 4;
    return selections.length >= requiredRaces;
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
    const today = new Date();
    const date = today.toISOString().slice(0, 10);

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
    if (user && !isAdmin && globalMeets.length) {
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
    const newSelection: Selection = { meetId, raceId, raceName, horseId, horseName };
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

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 p-6 flex items-center justify-center">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
          <h1 className="text-2xl font-bold mb-2">Horse Racing Syndicate</h1>
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
      <div className="min-h-screen bg-slate-50 text-slate-900 p-6">
        <div className="mx-auto max-w-5xl">
          <header className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Admin Dashboard</h1>
              <p className="mt-2 text-slate-600">Select the two meets that all users will use.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-700">Signed in as <strong>{user}</strong></span>
              <button
                onClick={() => {
                  void logout();
                }}
                className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
              >
                Log out
              </button>
            </div>
          </header>

          <section className="mb-10">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Global Meet Selection</h2>
              <button
                onClick={() => {
                  void setGlobalMeetSelection(selectedMeets);
                }}
                disabled={selectedMeets.length !== 2}
                className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Save as Global Meets
              </button>
            </div>

            <p className="mt-2 text-sm text-slate-500">
              Choose exactly two meets. These will be locked for all non-admin users.
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
                        void selectMeet(meet);
                      }}
                      disabled={selectedMeets.length >= 2 && !isSelectedMeet}
                      className={`mt-4 inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium shadow-sm transition ${
                        isSelectedMeet
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      } disabled:cursor-not-allowed disabled:bg-slate-300`}
                    >
                      {isSelectedMeet ? 'Selected' : 'Select'}
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

          <section className="mb-10">
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

          {globalMeets.length > 0 && (
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
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {(races[meet.meet_id] || []).slice(-4).map(race => {
                          const raceKey = `${meet.meet_id}|${race.id}`;
                          const selected = selections.find(s => s.meetId === meet.meet_id && s.raceId === race.id);
                          const expanded = raceExpanded[raceKey] ?? true;
                          const selectedRunner = selected ? race.runners.find(r => r.id === selected.horseId) : null;

                          return (
                            <div key={race.id} className="bg-white p-4 rounded-lg shadow-sm">
                              <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold">{race.name}</h3>
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

          {submitConfirmationModal}

          {selectedRunnerDetails && (
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
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Horse Racing Syndicate App</h1>
          <p className="mt-2 text-slate-600">
            Pick one horse per race in the last four races of two selected meets for tomorrow, then choose a wildcard horse for double points.
          </p>
        </header>

        {error ? (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{error}</div>
        ) : null}

        <div className="mb-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Global Meets</h2>
            <button
              onClick={() => {
                void logout();
              }}
              className="rounded-full bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
            >
              Log out
            </button>
          </div>

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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {(races[meet.meet_id] || []).slice(-4).map(race => {
                    const raceKey = `${meet.meet_id}|${race.id}`;
                    const selected = selections.find(s => s.meetId === meet.meet_id && s.raceId === race.id);
                    const expanded = raceExpanded[raceKey] ?? true;
                    const selectedRunner = selected ? race.runners.find(r => r.id === selected.horseId) : null;

                    return (
                      <div key={race.id} className="bg-white p-4 rounded-lg shadow-sm">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-semibold">{race.name}</h3>
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
              )}
            </div>
          ))}
        </div>

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

        <section>
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

        {selectedRunnerDetails && (
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

        {submitConfirmationModal}
      </div>
    </div>
  );
}

