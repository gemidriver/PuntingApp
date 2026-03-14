"use client";

import { useState, useEffect } from 'react';

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

interface UserSelections {
  username: string;
  selections: Selection[];
  wildcard: Wildcard | null;
  submitted: boolean;
  submittedAt?: string;
}

interface Wildcard {
  meetId: string;
  raceId: string;
}

export default function Home() {
  const [meets, setMeets] = useState<Meet[]>([]);
  const [selectedMeets, setSelectedMeets] = useState<Meet[]>([]);
  const [races, setRaces] = useState<{ [meetId: string]: Race[] }>({});
  const [raceLoading, setRaceLoading] = useState<{ [meetId: string]: boolean }>({});
  const [raceDebug, setRaceDebug] = useState<{ [meetId: string]: unknown }>({});
  const [selections, setSelections] = useState<Selection[]>([]);
  const [wildcard, setWildcard] = useState<Wildcard | null>(null);
  const [selectedRunnerDetails, setSelectedRunnerDetails] = useState<{runner: any, meetId: string, raceId: string, raceName: string} | null>(null);
  const [raceExpanded, setRaceExpanded] = useState<{ [key: string]: boolean }>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [allUsers, setAllUsers] = useState<Record<string, StoredUser>>({});
  const [globalMeets, setGlobalMeets] = useState<Meet[]>([]);

  const [submittedSelections, setSubmittedSelections] = useState<UserSelections | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const USERS_STORAGE_KEY = 'hrsa_users';
  const USER_SESSION_KEY = 'hrsa_user';
  const GLOBAL_MEETS_KEY = 'hrsa_global_meets';
  const USER_SELECTIONS_KEY = 'hrsa_user_selections';

  interface StoredUser {
    password: string;
    isAdmin?: boolean;
  }

  const loadUsers = () => {
    try {
      const raw = localStorage.getItem(USERS_STORAGE_KEY);
      if (!raw) return {};

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};

      // Normalize any legacy stored values (e.g., password stored directly as string)
      const normalized: Record<string, StoredUser> = {};
      Object.entries(parsed).forEach(([username, entry]) => {
        if (typeof entry === 'string') {
          normalized[username] = { password: entry, isAdmin: false };
        } else if (entry && typeof entry === 'object' && 'password' in entry) {
          normalized[username] = {
            password: (entry as any).password ?? '',
            isAdmin: Boolean((entry as any).isAdmin),
          };
        }
      });

      return normalized;
    } catch {
      return {};
    }
  };

  const saveUsers = (users: Record<string, StoredUser>) => {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  };

  const loadGlobalMeets = (): Meet[] => {
    try {
      const raw = localStorage.getItem(GLOBAL_MEETS_KEY);
      return raw ? (JSON.parse(raw) as Meet[]) : [];
    } catch {
      return [];
    }
  };

  const saveGlobalMeets = (meetsToSave: Meet[]) => {
    localStorage.setItem(GLOBAL_MEETS_KEY, JSON.stringify(meetsToSave));
    setGlobalMeets(meetsToSave);
  };

  const loadUserSelections = (): Record<string, UserSelections> => {
    try {
      const raw = localStorage.getItem(USER_SELECTIONS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  };

  const saveUserSelections = (username: string, selections: Selection[], wildcard: Wildcard | null, submitted: boolean = false) => {
    const allSelections = loadUserSelections();
    allSelections[username] = {
      username,
      selections,
      wildcard,
      submitted,
      submittedAt: submitted ? new Date().toISOString() : undefined,
    };
    localStorage.setItem(USER_SELECTIONS_KEY, JSON.stringify(allSelections));
  };


  const login = () => {
    const users = loadUsers();
    if (!authUsername || !authPassword) {
      setAuthError('Username and password are required.');
      return;
    }
    const userRecord = users[authUsername];
    if (!userRecord || userRecord.password !== authPassword) {
      setAuthError('Invalid username or password.');
      return;
    }
    localStorage.setItem(USER_SESSION_KEY, authUsername);
    setUser(authUsername);
    setIsAdmin(Boolean(userRecord.isAdmin));
    setAllUsers(users);
    setAuthError(null);
  };

  const register = () => {
    const users = loadUsers();
    if (!authUsername || !authPassword) {
      setAuthError('Username and password are required.');
      return;
    }
    if (users[authUsername]) {
      setAuthError('Username already exists.');
      return;
    }

    // First registered user becomes admin automatically.
    const initialIsAdmin = Object.keys(users).length === 0;
    const next = {
      ...users,
      [authUsername]: { password: authPassword, isAdmin: initialIsAdmin },
    };

    saveUsers(next);
    localStorage.setItem(USER_SESSION_KEY, authUsername);
    setUser(authUsername);
    setIsAdmin(initialIsAdmin);
    setAllUsers(next);
    setAuthError(null);
  };

  const logout = () => {
    localStorage.removeItem(USER_SESSION_KEY);
    setUser(null);
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

  const toggleAdmin = (username: string) => {
    const users = loadUsers();
    const record = users[username];
    if (!record) return;
    const next = {
      ...users,
      [username]: { ...record, isAdmin: !Boolean(record.isAdmin) },
    };
    saveUsers(next);
    setAllUsers(next);
    if (username === user) {
      setIsAdmin(Boolean(next[username].isAdmin));
    }
  };

  const submitSelections = () => {
    if (!user) return;

    saveUserSelections(user, selections, wildcard, true);
    setHasSubmitted(true);
    setSubmittedSelections({
      username: user,
      selections,
      wildcard,
      submitted: true,
      submittedAt: new Date().toISOString(),
    });
  };

  const canSubmit = () => {
    if (!globalMeets.length || hasSubmitted) return false;

    // Check if user has selected horses for all required races
    const requiredRaces = globalMeets.length * 4; // 4 races per meet
    return selections.length >= requiredRaces;
  };

  useEffect(() => {
    const stored = localStorage.getItem(USER_SESSION_KEY);
    if (stored) {
      setUser(stored);
      const users = loadUsers();
      setAllUsers(users);
      // TEMPORARY: Force admin for gemidriver
      const isAdminValue = Boolean(users[stored]?.isAdmin) || stored === 'gemidriver';
      setIsAdmin(isAdminValue);

      // Load user's previous selections
      const allSelections = loadUserSelections();
      const userSelections = allSelections[stored];
      if (userSelections) {
        setSelections(userSelections.selections);
        setWildcard(userSelections.wildcard);
        setHasSubmitted(userSelections.submitted);
        if (userSelections.submitted) {
          setSubmittedSelections(userSelections);
        }
      }

      const global = loadGlobalMeets();
      setGlobalMeets(global);
      if (global.length) {
        setSelectedMeets(global);
      }
    }
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
    // If we have global meets pre-configured, load their races (for non-admins).
    if (user && !isAdmin && globalMeets.length) {
      setSelectedMeets(globalMeets);
      // Load races sequentially to avoid overwhelming the API
      const loadRacesSequentially = async () => {
        for (const meet of globalMeets) {
          if (!races[meet.meet_id]) {
            await loadRacesForMeet(meet);
          }
        }
      };
      loadRacesSequentially();
    }
  }, [user, isAdmin, globalMeets]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === GLOBAL_MEETS_KEY) {
        const next = event.newValue ? (JSON.parse(event.newValue) as Meet[]) : [];
        setGlobalMeets(next);
        if (user && !isAdmin) {
          setSelectedMeets(next);
        }
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user, isAdmin]);

  const loadRacesForMeet = async (meet: Meet) => {
    console.log('loadRacesForMeet: called with meet=', meet);
    setRaceLoading(prev => ({ ...prev, [meet.meet_id]: true }));

    try {
      console.log('loadRacesForMeet: fetching /api/races?courseId=', meet.meet_id, '&date=', meet.date);
      const res = await fetch(
        `/api/races?courseId=${encodeURIComponent(meet.meet_id)}&date=${encodeURIComponent(meet.date)}`
      );
      console.log('loadRacesForMeet: fetch response ok=', res.ok, 'status=', res.status);
      if (!res.ok) {
        throw new Error('Unable to load races');
      }
      const data = await res.json();
      console.log('loadRacesForMeet: received data with', data.races?.length || 0, 'races');
      setRaces(prev => ({ ...prev, [meet.meet_id]: data.races || [] }));

      // Expand races by default when they first load.
      setRaceExpanded(prev => {
        const next = { ...prev };
        (data.races || []).forEach((race: Race) => {
          const key = `${meet.meet_id}|${race.id}`;
          next[key] = true;
        });
        return next;
      });
    } catch (err) {
      console.error('loadRacesForMeet: error loading races for meet', meet, err);
      // Don't show error to user, just log it and set empty races
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
    // Scroll down to the races section once a meet is selected.
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
    setSelections(prev => {
      const existing = prev.find(s => s.meetId === meetId && s.raceId === raceId);
      const newSelection: Selection = { meetId, raceId, raceName, horseId, horseName };
      if (existing) {
        return prev.map(s => (s.meetId === meetId && s.raceId === raceId ? newSelection : s));
      }
      return [...prev, newSelection];
    });

    // Auto-collapse the race card once a horse is selected.
    setRaceExpanded(prev => ({ ...prev, [`${meetId}|${raceId}`]: false }));

    // If the wildcard was selected for a different race, keep it.
    // If it was selected for the same race, update to the new horse.
    setWildcard(prev => {
      if (!prev) return null;
      if (prev.meetId === meetId && prev.raceId === raceId) {
        return prev;
      }
      return prev;
    });

    // Auto-save selections (but not submitted yet)
    if (user && !hasSubmitted) {
      const newSelections = selections.filter(s => !(s.meetId === meetId && s.raceId === raceId));
      newSelections.push({ meetId, raceId, raceName, horseId, horseName });
      saveUserSelections(user, newSelections, wildcard, false);
    }
  };

  const isSelected = (meetId: string, raceId: string, horseId: string) => {
    return selections.some(s => s.meetId === meetId && s.raceId === raceId && s.horseId === horseId);
  };

  const selectedWildcards = (meetId: string, raceId: string) => {
    return wildcard?.meetId === meetId && wildcard?.raceId === raceId;
  };

  const wildcardOptions = selections.map(sel => {
    const course = selectedMeets.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId;
    const race = races[sel.meetId]?.find(r => r.id === sel.raceId);
    const runner = race?.runners.find(r => r.id === sel.horseId);
    const oddsLabel = runner?.odds ? ` - $${runner.odds}` : '';

    return {
      value: `${sel.meetId}|${sel.raceId}`,
      label: `${sel.horseName}${oddsLabel} ; (${sel.raceName} @ ${course})`,
    };
  });

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
              <label className="block text-xs font-semibold text-slate-600 mb-1">Username</label>
              <input
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
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
            onClick={authMode === 'login' ? login : register}
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
                onClick={logout}
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
                onClick={() => setGlobalMeetSelection(selectedMeets)}
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
                      onClick={() => selectMeet(meet)}
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
                      <p className="text-xs text-slate-500">{record.isAdmin ? 'Admin' : 'User'}</p>
                    </div>
                    <button
                      onClick={() => toggleAdmin(username)}
                      className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300"
                    >
                      {record.isAdmin ? 'Revoke Admin' : 'Make Admin'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Admin Horse Selection Section */}
          {globalMeets.length > 0 && (
            <section className="mb-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">My Horse Selections</h2>
                {hasSubmitted ? (
                  <span className="text-sm text-green-600 font-medium">✓ Submitted</span>
                ) : canSubmit() ? (
                  <button
                    onClick={submitSelections}
                    className="rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700"
                  >
                    Submit Selections
                  </button>
                ) : (
                  <span className="text-sm text-slate-500">
                    Select horses for all races to submit
                  </span>
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

              {/* Include the horse selection interface for admins */}
              <div id="races-section">
                {selectedMeets.map(meet => (
                  <div key={meet.meet_id} className="mb-10">
                    <h3 className="text-lg font-semibold mb-3">
                      {meet.course} - Last 4 Races
                    </h3>
                    {raceLoading[meet.meet_id] ? (
                      <div className="rounded-lg bg-white p-4 shadow-sm">
                        <p className="text-sm text-slate-500">Loading races…</p>
                      </div>
                    ) : (races[meet.meet_id] || []).length === 0 ? (
                      <div className="rounded-lg bg-white p-6 shadow-sm">
                        <p className="text-sm text-slate-600">
                          No races were found for this meet.
                        </p>
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
                                          setSelectedRunnerDetails({runner, meetId: meet.meet_id, raceId: race.id, raceName: race.name});
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
                      if (user && !hasSubmitted) {
                        saveUserSelections(user, selections, null, false);
                      }
                      return;
                    }
                    const [meetId, raceId] = value.split('|');
                    const sel = selections.find(s => s.meetId === meetId && s.raceId === raceId);
                    if (!sel) return;
                    setWildcard({ meetId, raceId });
                    if (user && !hasSubmitted) {
                      saveUserSelections(user, selections, { meetId, raceId }, false);
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
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mb-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Global Meets</h2>
            <button
              onClick={logout}
              className="rounded-full bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
            >
              Log out
            </button>
          </div>

          {globalMeets.length === 0 ? (
            <div className="mt-4 rounded-lg bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">
                Waiting for an admin to select the two race meets for this session.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Once an admin has chosen the meets, they will appear here automatically.
              </p>
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
              <h2 className="text-xl font-semibold mb-3">
                {meet.course} - Last 4 Races
              </h2>
            {raceLoading[meet.meet_id] ? (
              <div className="rounded-lg bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Loading races…</p>
              </div>
            ) : (races[meet.meet_id] || []).length === 0 ? (
              <div className="rounded-lg bg-white p-6 shadow-sm">
                <p className="text-sm text-slate-600">
                  No races were found for this meet. This can happen if the API returned no racecards for the selected course or if the course ID format differs from what the API expects.
                </p>
                <p className="mt-3 text-sm text-slate-500">
                  Try selecting a different meet or enabling mock mode (set <code>USE_MOCK_DATA=true</code> in <code>.env.local</code>).
                </p>
                <button
                  onClick={() => loadRaceDebug(meet)}
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
                                  setSelectedRunnerDetails({runner, meetId: meet.meet_id, raceId: race.id, raceName: race.name});
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
                })}              </div>
            )}
          </div>
        ))}
        </div>

        {globalMeets.length > 0 && (
          <div className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">My Horse Selections</h2>
              {hasSubmitted ? (
                <span className="text-sm text-green-600 font-medium">✓ Submitted</span>
              ) : canSubmit() ? (
                <button
                  onClick={submitSelections}
                  className="rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700"
                >
                  Submit Selections
                </button>
              ) : (
                <span className="text-sm text-slate-500">
                  Select horses for all races to submit
                </span>
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
                return;
              }
              const [meetId, raceId] = value.split('|');
              const sel = selections.find(s => s.meetId === meetId && s.raceId === raceId);
              if (!sel) return;
              setWildcard({ meetId, raceId });
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
      </div>
    </div>
  );
}
