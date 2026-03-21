"use client";

import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabase';
import { APP_VERSION_LABEL } from './version';

interface Meet {
  meet_id: string;
  course: string;
  date: string;
  state: string;
  raceType?: 'Thoroughbred' | 'Harness';
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

interface BetfairHealthStatus {
  ok: boolean;
  date: string;
  env?: {
    appKeyConfigured: boolean;
    sessionTokenConfigured: boolean;
  };
  auth?: {
    autoLoginConfigured: boolean;
    autoLoginUsedDuringCheck: boolean;
    lastAutoLoginAt: string | null;
  };
  checks?: {
    eventTypeCount: number;
    competitionCount: number;
    marketCount: number;
    marketWithCompetitionCount: number;
    marketWithEventCount: number;
  };
  samples?: {
    firstCompetition: { id: string; name: string } | null;
    firstMarket: {
      marketId: string;
      marketName: string;
      competitionId: string | null;
      competitionName: string | null;
      eventId: string | null;
      eventName: string | null;
    } | null;
  };
  error?: string;
}

interface Notification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number; // in ms; 0 means manual dismissal
}

const GLOBAL_MEETS_SETTING_KEY = 'global_meets';
const RACE_RESULTS_SETTING_KEY = 'race_results';
const RACE_RUNNERS_SETTING_KEY = 'race_runners';
const PREVIOUS_ROUND_SNAPSHOT_SETTING_KEY = 'previous_round_snapshot';

type RaceResultEntry = {
  winnerId: string;
  winnerName: string | null;
  secondId?: string | null;
  secondName?: string | null;
  thirdId?: string | null;
  thirdName?: string | null;
  inferredPlaces?: boolean;
};

type RaceResultsMap = Record<string, RaceResultEntry>;
type RaceRunnersMap = Record<string, Array<{ horseId: string; horseName: string }>>;
type RaceResultRow = {
  meet_id: string;
  race_id: string;
  horse_id: string;
  horse_name: string | null;
  finishing_position: number;
  result_date: string | null;
};
type ScoreboardEntry = { username: string; score: number };
type RankedScoreboardEntry = ScoreboardEntry & { rank: number; isTied: boolean };
type PodiumGroup = { rank: number; score: number; entries: RankedScoreboardEntry[] };
type PreviousRoundSnapshot = {
  capturedAt: string;
  meets: Meet[];
  scoreboard: ScoreboardEntry[];
  results: Array<{
    raceId: string;
    raceName: string;
    location: string;
    winnerName: string | null;
    secondName: string | null;
    thirdName: string | null;
    inferredPlaces?: boolean;
  }>;
};

const getTodayDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
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
const formatHorseDisplayName = (name: string, number?: number | null) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  if (/^\d+\.\s+/.test(trimmed)) return trimmed;
  return typeof number === 'number' ? `${number}. ${trimmed}` : trimmed;
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
const extractRaceNumber = (value: string | null | undefined): number => {
  const trimmed = String(value || '').trim();
  const match = trimmed.match(/R(\d+)/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};
const normalizeHorseNameForComparison = (value: string | null | undefined) => {
  return String(value || '')
    .trim()
    .replace(/^\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
};
const normalizeMeetRaceType = (value?: string | null): 'Thoroughbred' | 'Harness' => {
  return value === 'Harness' ? 'Harness' : 'Thoroughbred';
};
const rankScoreboard = (entries: ScoreboardEntry[]): RankedScoreboardEntry[] => {
  const sortedEntries = [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.username.localeCompare(b.username);
  });

  const scoreCounts = sortedEntries.reduce((acc, entry) => {
    acc.set(entry.score, (acc.get(entry.score) || 0) + 1);
    return acc;
  }, new Map<number, number>());

  let previousScore: number | null = null;
  let previousRank = 0;

  return sortedEntries.map((entry, index) => {
    const rank = previousScore === entry.score ? previousRank : index + 1;
    previousScore = entry.score;
    previousRank = rank;

    return {
      ...entry,
      rank,
      isTied: (scoreCounts.get(entry.score) || 0) > 1,
    };
  });
};
const formatRankLabel = (rank: number) => {
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
};
const buildRacesUrl = (meetId: string, date: string, raceType?: string, debug = false) => {
  const params = new URLSearchParams({
    courseId: meetId,
    date,
  });
  if (raceType) {
    params.set('raceType', normalizeMeetRaceType(raceType));
  }
  if (debug) {
    params.set('debug', 'true');
  }
  return `/api/races?${params.toString()}`;
};
const isRunnerPlaceholderName = (value: string | null | undefined) => {
  const trimmed = String(value || '').trim();
  return /^(?:\d+\.\s*)?Runner\s+\d+$/i.test(trimmed);
};
const preferResolvedHorseName = (
  storedName: string | null | undefined,
  fallbackName: string | null | undefined,
  fallbackId: string | null | undefined
) => {
  const stored = String(storedName || '').trim();
  const fallback = String(fallbackName || '').trim();
  if (stored && !isRunnerPlaceholderName(stored)) return stored;
  if (fallback && !isRunnerPlaceholderName(fallback)) return fallback;
  if (stored) return stored;
  if (fallback) return fallback;
  return fallbackId ?? null;
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
  const [adminSelectedMeets, setAdminSelectedMeets] = useState<Meet[]>([]);

  const [submittedSelections, setSubmittedSelections] = useState<UserSelections | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeScreen, setActiveScreen] = useState<'home' | 'main' | 'admin' | 'submissions' | 'leaderboard'>('home');
  const [submissionRows, setSubmissionRows] = useState<SubmissionRow[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [raceResults, setRaceResults] = useState<RaceResultsMap>({});
  const [raceRunnersCache, setRaceRunnersCache] = useState<RaceRunnersMap>({});
  const [resultsFetching, setResultsFetching] = useState(false);
  const [resultsAutoRefresh, setResultsAutoRefresh] = useState(false);
  const [resultsLastRefreshedAt, setResultsLastRefreshedAt] = useState<string | null>(null);
  const [manualResultRaceId, setManualResultRaceId] = useState('');
  const [manualResultHorseId, setManualResultHorseId] = useState('');
  const [manualResultSecondHorseId, setManualResultSecondHorseId] = useState('');
  const [manualResultThirdHorseId, setManualResultThirdHorseId] = useState('');
  const [manualResultHorseName, setManualResultHorseName] = useState('');
  const [manualResultSecondHorseName, setManualResultSecondHorseName] = useState('');
  const [manualResultThirdHorseName, setManualResultThirdHorseName] = useState('');
  const [manualRunnersByRaceId, setManualRunnersByRaceId] = useState<Record<string, Array<{ horseId: string; horseName: string }>>>({});
  const [manualRunnersLoading, setManualRunnersLoading] = useState(false);
  const [manualApplyNotice, setManualApplyNotice] = useState<string | null>(null);
  const [previousRoundSnapshot, setPreviousRoundSnapshot] = useState<PreviousRoundSnapshot | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [betfairHealth, setBetfairHealth] = useState<BetfairHealthStatus | null>(null);
  const [betfairHealthLoading, setBetfairHealthLoading] = useState(false);
  const [betfairHealthError, setBetfairHealthError] = useState<string | null>(null);
  const [betfairHealthCheckedAt, setBetfairHealthCheckedAt] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info', duration: number = 5000) => {
    const id = String(Date.now() + Math.random());
    const notification: Notification = { id, message, type, duration };
    setNotifications(prev => [...prev, notification]);

    if (duration > 0) {
      const timer = setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, duration);
      return () => clearTimeout(timer);
    }
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const meetsForPicks = globalMeets.length ? globalMeets : selectedMeets;

  const resolveRaceHorseName = (
    raceId: string,
    horseId: string | null | undefined,
    preferredName?: string | null
  ): string | null => {
    if (!raceId || !horseId) return null;

    const normalizedPreferred = String(preferredName || '').trim();
    if (normalizedPreferred && !isRunnerPlaceholderName(normalizedPreferred)) {
      return normalizedPreferred;
    }

    const fromManual = (manualRunnersByRaceId[raceId] || []).find((runner) => runner.horseId === horseId);
    if (fromManual?.horseName && !isRunnerPlaceholderName(fromManual.horseName)) {
      return fromManual.horseName;
    }

    const fromCache = (raceRunnersCache[raceId] || []).find((runner) => runner.horseId === horseId);
    if (fromCache?.horseName && !isRunnerPlaceholderName(fromCache.horseName)) {
      return fromCache.horseName;
    }

    for (const raceList of Object.values(races)) {
      const race = (raceList || []).find((item) => item.id === raceId);
      const runner = race?.runners.find((item) => item.id === horseId);
      if (runner) {
        const formattedName = formatHorseDisplayName(runner.name, runner.number);
        if (formattedName && !isRunnerPlaceholderName(formattedName)) {
          return formattedName;
        }
      }
    }

    for (const row of submissionRows) {
      const selection = row.selections.find((item) => item.raceId === raceId && item.horseId === horseId);
      if (selection?.horseName && !isRunnerPlaceholderName(selection.horseName)) {
        return selection.horseName;
      }
    }

    const storedResult = raceResults[raceId];
    if (storedResult?.winnerId === horseId && storedResult.winnerName && !isRunnerPlaceholderName(storedResult.winnerName)) {
      return storedResult.winnerName;
    }
    if (storedResult?.secondId === horseId && storedResult.secondName && !isRunnerPlaceholderName(storedResult.secondName)) {
      return storedResult.secondName;
    }
    if (storedResult?.thirdId === horseId && storedResult.thirdName && !isRunnerPlaceholderName(storedResult.thirdName)) {
      return storedResult.thirdName;
    }

    if (normalizedPreferred) {
      return normalizedPreferred;
    }

    return horseId;
  };

  const horseMatchesResult = (
    raceId: string,
    selectionHorseId: string,
    selectionHorseName: string,
    resultHorseId: string | null | undefined,
    resultHorseName?: string | null
  ) => {
    if (!resultHorseId && !resultHorseName) return false;
    if (resultHorseId && selectionHorseId === resultHorseId) return true;

    const resolvedResultName = resolveRaceHorseName(raceId, resultHorseId, resultHorseName);
    const selectionNormalized = normalizeHorseNameForComparison(selectionHorseName);
    const resultNormalized = normalizeHorseNameForComparison(resolvedResultName);

    if (
      selectionNormalized &&
      resultNormalized &&
      !isRunnerPlaceholderName(selectionHorseName) &&
      !isRunnerPlaceholderName(resolvedResultName) &&
      selectionNormalized === resultNormalized
    ) {
      return true;
    }

    const selectionNumber = extractHorseNumber(selectionHorseName);
    const resultNumber = extractHorseNumber(resolvedResultName);

    if (selectionNumber !== null && resultNumber !== null && selectionNumber === resultNumber) {
      return true;
    }

    return false;
  };

  const getMeetIdForRaceId = (raceId: string): string | null => {
    for (const [meetId, raceList] of Object.entries(races)) {
      if ((raceList || []).some((race) => race.id === raceId)) {
        return meetId;
      }
    }

    for (const row of submissionRows) {
      const selection = row.selections.find((item) => item.raceId === raceId);
      if (selection?.meetId) {
        return selection.meetId;
      }
    }

    const activeSelection = activeSelections.find((item) => item.raceId === raceId);
    if (activeSelection?.meetId) {
      return activeSelection.meetId;
    }

    return null;
  };

  const getResultDateForMeetId = (meetId: string | null) => {
    if (!meetId) return getTodayDate();
    const matchingMeet = [...globalMeets, ...selectedMeets, ...adminSelectedMeets].find((meet) => meet.meet_id === meetId);
    return matchingMeet?.date || getTodayDate();
  };

  const getMeetSortIndex = (meetId: string | null | undefined, location?: string | null) => {
    const allMeets = [...meetsForPicks, ...globalMeets, ...selectedMeets, ...adminSelectedMeets];
    const directIndex = allMeets.findIndex((meet) => meet.meet_id === meetId);
    if (directIndex >= 0) return directIndex;

    const normalizedLocation = String(location || '').trim().toLowerCase();
    const locationIndex = allMeets.findIndex((meet) => meet.course.trim().toLowerCase() === normalizedLocation);
    if (locationIndex >= 0) return locationIndex;

    return Number.MAX_SAFE_INTEGER;
  };

  const compareSelectionsByMeetAndRace = (a: Selection, b: Selection) => {
    const meetIndexDiff = getMeetSortIndex(a.meetId, a.meetCourse) - getMeetSortIndex(b.meetId, b.meetCourse);
    if (meetIndexDiff !== 0) return meetIndexDiff;

    const raceNumberDiff = extractRaceNumber(a.raceName) - extractRaceNumber(b.raceName);
    if (raceNumberDiff !== 0) return raceNumberDiff;

    return a.raceName.localeCompare(b.raceName);
  };

  const buildRaceResultsMapFromRows = (rows: RaceResultRow[]): RaceResultsMap => {
    const nextMap: RaceResultsMap = {};

    rows.forEach((row) => {
      if (!nextMap[row.race_id]) {
        nextMap[row.race_id] = {
          winnerId: '',
          winnerName: null,
          secondId: null,
          secondName: null,
          thirdId: null,
          thirdName: null,
        };
      }

      const target = nextMap[row.race_id];
      if (row.finishing_position === 1) {
        target.winnerId = row.horse_id;
        target.winnerName = row.horse_name;
      } else if (row.finishing_position === 2) {
        target.secondId = row.horse_id;
        target.secondName = row.horse_name;
      } else if (row.finishing_position === 3) {
        target.thirdId = row.horse_id;
        target.thirdName = row.horse_name;
      }
    });

    return nextMap;
  };

  const persistRaceResultsRows = async (map: RaceResultsMap, raceIds: string[]) => {
    if (!raceIds.length) return { error: null as string | null };

    const supabase = getSupabaseClient();
    const uniqueRaceIds = [...new Set(raceIds.filter(Boolean))];
    const rowsToInsert: RaceResultRow[] = [];

    uniqueRaceIds.forEach((raceId) => {
      const result = map[raceId];
      const meetId = getMeetIdForRaceId(raceId);
      if (!result || !meetId) {
        return;
      }

      const resultDate = getResultDateForMeetId(meetId);
      if (result.winnerId) {
        rowsToInsert.push({
          meet_id: meetId,
          race_id: raceId,
          horse_id: result.winnerId,
          horse_name: result.winnerName ?? null,
          finishing_position: 1,
          result_date: resultDate,
        });
      }
      if (result.secondId) {
        rowsToInsert.push({
          meet_id: meetId,
          race_id: raceId,
          horse_id: result.secondId,
          horse_name: result.secondName ?? null,
          finishing_position: 2,
          result_date: resultDate,
        });
      }
      if (result.thirdId) {
        rowsToInsert.push({
          meet_id: meetId,
          race_id: raceId,
          horse_id: result.thirdId,
          horse_name: result.thirdName ?? null,
          finishing_position: 3,
          result_date: resultDate,
        });
      }
    });

    const { error: deleteError } = await supabase
      .from('race_results')
      .delete()
      .in('race_id', uniqueRaceIds);

    if (deleteError) {
      return { error: deleteError.message };
    }

    if (!rowsToInsert.length) {
      return { error: null };
    }

    const { error: insertError } = await supabase
      .from('race_results')
      .insert(rowsToInsert);

    return { error: insertError?.message ?? null };
  };

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

  const normalizeMeetList = (items: Meet[] = []): Meet[] => {
    return items.map((meet) => ({
      ...meet,
      raceType: normalizeMeetRaceType(meet.raceType),
    }));
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
      addNotification('Unable to save selections to Supabase.', 'error');
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
      return normalizeMeetList(value as Meet[]);
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
    setManualResultSecondHorseId('');
    setManualResultThirdHorseId('');
    setManualResultHorseName('');
    setManualResultSecondHorseName('');
    setManualResultThirdHorseName('');
  };

  const clearMeetState = () => {
    setGlobalMeets([]);
    setSelectedMeets([]);
    setAdminSelectedMeets([]);
    setRaces({});
    setRaceLoading({});
    setRaceDebug({});
    setRaceExpanded({});
    setRaceResults({});
    setRaceRunnersCache({});
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
    const { data: tableRows, error: tableError } = await supabase
      .from('race_results')
      .select('meet_id,race_id,horse_id,horse_name,finishing_position,result_date')
      .order('finishing_position', { ascending: true });

    if (!tableError && Array.isArray(tableRows) && tableRows.length) {
      setRaceResults(buildRaceResultsMapFromRows(tableRows as RaceResultRow[]));
      return;
    }

    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', RACE_RESULTS_SETTING_KEY)
      .maybeSingle();
    if (data?.value && typeof data.value === 'object') {
      setRaceResults(data.value as RaceResultsMap);
    }
  };

  const loadRaceRunnersCache = async () => {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', RACE_RUNNERS_SETTING_KEY)
      .maybeSingle();
    if (data?.value && typeof data.value === 'object') {
      setRaceRunnersCache(data.value as RaceRunnersMap);
    }
  };

  const loadPreviousRoundSnapshot = async () => {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', PREVIOUS_ROUND_SNAPSHOT_SETTING_KEY)
      .maybeSingle();

    if (data?.value && typeof data.value === 'object') {
      setPreviousRoundSnapshot(data.value as PreviousRoundSnapshot);
      return;
    }

    // Fallback for environments using append-only historical storage
    const { data: historyRows, error: historyError } = await supabase
      .from('round_history')
      .select('round_closed_at,meets,scoreboard,results')
      .order('round_closed_at', { ascending: false })
      .limit(1);

    if (!historyError && Array.isArray(historyRows) && historyRows.length > 0) {
      const latest = historyRows[0] as {
        round_closed_at?: string;
        meets?: Meet[];
        scoreboard?: Array<{ username: string; score: number }>;
        results?: Array<{
          raceId: string;
          raceName: string;
          location: string;
          winnerName: string | null;
          secondName: string | null;
          thirdName: string | null;
        }>;
      };

      setPreviousRoundSnapshot({
        capturedAt: latest.round_closed_at || new Date().toISOString(),
        meets: Array.isArray(latest.meets) ? latest.meets : [],
        scoreboard: Array.isArray(latest.scoreboard) ? latest.scoreboard : [],
        results: Array.isArray(latest.results) ? latest.results : [],
      });
      return;
    }

    setPreviousRoundSnapshot(null);
  };

  const persistRaceRunnersCache = async (nextCache: RaceRunnersMap) => {
    const supabase = getSupabaseClient();
    await supabase.from('app_settings').upsert(
      { key: RACE_RUNNERS_SETTING_KEY, value: nextCache },
      { onConflict: 'key' }
    );
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
      const data = await res.json() as { results?: { marketId: string; winnerId: string | null; secondId?: string | null; thirdId?: string | null; settled: boolean; inferredPlaces?: boolean }[]; error?: string };

      if (!res.ok) {
        addNotification(data.error || 'Failed to fetch results from /api/results.', 'error');
        return;
      }

      if (!Array.isArray(data.results)) {
        addNotification('Unexpected response from /api/results.', 'error');
        return;
      }

      setError(null);

      const map: RaceResultsMap = { ...raceResults };

      data.results.forEach(r => {
        if (!r.winnerId) {
          return;
        }

        const existing = map[r.marketId] || { winnerId: '', winnerName: null };
        const nextSecondId = existing.secondId || r.secondId || null;
        const nextThirdId = existing.thirdId || r.thirdId || null;

        map[r.marketId] = {
          ...existing,
          winnerId: r.winnerId,
          winnerName: resolveRaceHorseName(r.marketId, r.winnerId, existing.winnerName),
          secondId: nextSecondId,
          secondName: nextSecondId ? resolveRaceHorseName(r.marketId, nextSecondId, existing.secondName) : existing.secondName ?? null,
          thirdId: nextThirdId,
          thirdName: nextThirdId ? resolveRaceHorseName(r.marketId, nextThirdId, existing.thirdName) : existing.thirdName ?? null,
          inferredPlaces: r.inferredPlaces ?? false,
        };
      });

      const supabase = getSupabaseClient();
      const raceIds = [...new Set(data.results.map((result) => result.marketId).filter(Boolean))];
      const { error: persistResultsError } = await persistRaceResultsRows(map, raceIds);
      if (persistResultsError) {
        addNotification('Fetched results loaded, but database persistence failed.', 'warning');
      }

      await supabase.from('app_settings').upsert(
        { key: RACE_RESULTS_SETTING_KEY, value: map },
        { onConflict: 'key' }
      );
      setRaceResults(map);

      const settledCount = data.results.filter(r => r.settled).length;
      const winnersCount = data.results.filter(r => r.winnerId).length;
      if (settledCount === 0) {
        addNotification('No settled markets yet. Try Fetch Results again after races settle.', 'warning');
      } else if (winnersCount === 0) {
        addNotification('Markets are settled, but no winners were returned by Betfair data for these market IDs.', 'warning');
      }
    } finally {
      setResultsFetching(false);
    }
  };

  const applyManualResult = async () => {
    setManualApplyNotice(null);

    if (!manualResultRaceId) {
      addNotification('Choose a race before applying manual placings.', 'warning');
      return;
    }

    if (!manualResultHorseId && !manualResultSecondHorseId && !manualResultThirdHorseId) {
      addNotification('Select at least one placing (winner, 2nd, or 3rd).', 'warning');
      return;
    }

    const selectedPlaceIds = [manualResultHorseId, manualResultSecondHorseId, manualResultThirdHorseId].filter(Boolean);
    if (new Set(selectedPlaceIds).size !== selectedPlaceIds.length) {
      addNotification('Winner, 2nd, and 3rd must be different horses.', 'warning');
      return;
    }

    const existing = raceResults[manualResultRaceId];
    const winnerId = manualResultHorseId || existing?.winnerId || '';

    if (!winnerId) {
      addNotification('A winner is required for scoring. Select winner before saving.', 'warning');
      return;
    }

    const map: RaceResultsMap = {
      ...raceResults,
      [manualResultRaceId]: {
        winnerId,
        winnerName: getPreferredManualHorseName(winnerId, manualResultHorseName, existing?.winnerName),
        secondId: manualResultSecondHorseId || null,
        secondName: manualResultSecondHorseId
          ? getPreferredManualHorseName(manualResultSecondHorseId, manualResultSecondHorseName, existing?.secondName)
          : null,
        thirdId: manualResultThirdHorseId || null,
        thirdName: manualResultThirdHorseId
          ? getPreferredManualHorseName(manualResultThirdHorseId, manualResultThirdHorseName, existing?.thirdName)
          : null,
      },
    };

    const manualRunnerOverrides = [
      { horseId: winnerId, horseName: map[manualResultRaceId].winnerName },
      { horseId: manualResultSecondHorseId, horseName: map[manualResultRaceId].secondName },
      { horseId: manualResultThirdHorseId, horseName: map[manualResultRaceId].thirdName },
    ].filter((entry) => entry.horseId && entry.horseName) as Array<{ horseId: string; horseName: string }>;

    if (manualRunnerOverrides.length) {
      setManualRunnersByRaceId((prev) => {
        const existingOptions = prev[manualResultRaceId] || [];
        const merged = [...existingOptions];

        manualRunnerOverrides.forEach((entry) => {
          const index = merged.findIndex((option) => option.horseId === entry.horseId);
          if (index >= 0) {
            merged[index] = { ...merged[index], horseName: entry.horseName };
          } else {
            merged.push(entry);
          }
        });

        return { ...prev, [manualResultRaceId]: merged };
      });

      setRaceRunnersCache((prev) => {
        const existingOptions = prev[manualResultRaceId] || [];
        const merged = [...existingOptions];

        manualRunnerOverrides.forEach((entry) => {
          const index = merged.findIndex((option) => option.horseId === entry.horseId);
          if (index >= 0) {
            merged[index] = { ...merged[index], horseName: entry.horseName };
          } else {
            merged.push(entry);
          }
        });

        const next = { ...prev, [manualResultRaceId]: merged };
        void persistRaceRunnersCache(next);
        return next;
      });
    }

    const supabase = getSupabaseClient();
    const { error: tableSaveError } = await persistRaceResultsRows(map, [manualResultRaceId]);
    if (tableSaveError) {
      addNotification('Unable to save manual placings to race_results.', 'error');
      return;
    }

    const { error: saveError } = await supabase.from('app_settings').upsert(
      { key: RACE_RESULTS_SETTING_KEY, value: map },
      { onConflict: 'key' }
    );

    if (saveError) {
      addNotification('Unable to save manual placings.', 'error');
      return;
    }

    setRaceResults(map);

    const raceLabel = manualRaceOptions.find((race) => race.raceId === manualResultRaceId)?.label || manualResultRaceId;
    const winnerName = map[manualResultRaceId]?.winnerName || map[manualResultRaceId]?.winnerId || 'N/A';
    const secondName = map[manualResultRaceId]?.secondName || map[manualResultRaceId]?.secondId || 'N/A';
    const thirdName = map[manualResultRaceId]?.thirdName || map[manualResultRaceId]?.thirdId || 'N/A';
    const message = `Manual placings saved for ${raceLabel}: 1st ${winnerName}, 2nd ${secondName}, 3rd ${thirdName}.`;
    setManualApplyNotice(message);
    addNotification(message, 'success', 5000);
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
    setAdminSelectedMeets(meetsFromDb);
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
    await loadRaceRunnersCache();
    await loadPreviousRoundSnapshot();
  };

  const clearUserState = () => {
    setUser(null);
    setUserId(null);
    setIsAdmin(false);
    setAllUsers({});
    clearSelectionState();
    clearMeetState();
    setPreviousRoundSnapshot(null);
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
        setAuthError('Username login is unavailable right now. Please sign in with your email address.');
        return;
      }

      if (!profile?.email) {
        setAuthError('No account found for that username. Try signing in with your email address.');
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
      addNotification('Unable to update admin role. Ensure your SQL policies are applied.', 'error');
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

    const snapshotToPersist: PreviousRoundSnapshot | null =
      scoreboard.length || lastRoundRaceResults.length
        ? {
            capturedAt: new Date().toISOString(),
            meets: globalMeets,
            scoreboard,
            results: lastRoundRaceResults,
          }
        : null;

    if (snapshotToPersist) {
      const { error: snapshotError } = await supabase
        .from('app_settings')
        .upsert(
          { key: PREVIOUS_ROUND_SNAPSHOT_SETTING_KEY, value: snapshotToPersist },
          { onConflict: 'key' }
        );

      if (snapshotError) {
        console.error(snapshotError);
      } else {
        setPreviousRoundSnapshot(snapshotToPersist);
      }

      // Also keep an append-only historical record for multi-round lookup/reporting.
      const { error: historyInsertError } = await supabase
        .from('round_history')
        .insert({
          round_closed_at: snapshotToPersist.capturedAt,
          meets: snapshotToPersist.meets,
          scoreboard: snapshotToPersist.scoreboard,
          results: snapshotToPersist.results,
        });

      if (historyInsertError) {
        // Do not block day reset if historical table has not been created yet.
        console.error(historyInsertError);
      }
    }

    const { error: raceResultsResetError } = await supabase
      .from('race_results')
      .delete()
      .gte('finishing_position', 1);

    if (raceResultsResetError) {
      console.error(raceResultsResetError);
      addNotification('Unable to reset the current race day.', 'error');
      return false;
    }

    const { error: settingsError } = await supabase
      .from('app_settings')
      .upsert(
        [
          { key: GLOBAL_MEETS_SETTING_KEY, value: nextGlobalMeets },
          { key: RACE_RESULTS_SETTING_KEY, value: {} },
          { key: RACE_RUNNERS_SETTING_KEY, value: {} },
        ],
        { onConflict: 'key' }
      );

    if (settingsError) {
      console.error(settingsError);
      addNotification('Unable to reset the current race day.', 'error');
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
      addNotification('Race meets were updated, but user selections could not be reset.', 'warning');
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
    if (adminSelectedMeets.length !== 2) {
      addNotification('Choose exactly two meets before publishing them.', 'warning');
      return;
    }

    const meetsToPublish = [...adminSelectedMeets];
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
      addNotification('Your selections have been submitted successfully!', 'success', 5000);
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

    const totalRaces = meetsForPicks.reduce((sum, meet) => {
      return sum + (races[meet.meet_id] || []).slice(-4).length;
    }, 0);

    return totalRaces > 0 && selections.length >= totalRaces;
  };

  const runBetfairHealthCheck = async () => {
    setBetfairHealthLoading(true);
    try {
      const date = getTodayDate();
      const response = await fetch(`/api/health/betfair?date=${encodeURIComponent(date)}`);
      const contentType = response.headers.get('content-type') || '';
      const raw = await response.text();

      let payload: BetfairHealthStatus | null = null;
      if (contentType.includes('application/json')) {
        payload = JSON.parse(raw) as BetfairHealthStatus;
      }

      if (!payload) {
        const preview = raw.slice(0, 120).replace(/\s+/g, ' ').trim();
        setBetfairHealth(null);
        setBetfairHealthError(
          `Health endpoint returned non-JSON (${response.status}). This usually means a cloud routing/protection error page. Preview: ${preview}`
        );
        return;
      }

      if (!response.ok) {
        setBetfairHealth(payload);
        setBetfairHealthError(payload.error || 'Betfair health check failed.');
        return;
      }

      setBetfairHealth(payload);
      setBetfairHealthError(null);
      setBetfairHealthCheckedAt(new Date().toISOString());
    } catch (err) {
      console.error('runBetfairHealthCheck failed', err);
      setBetfairHealthError('Unable to run Betfair health check right now.');
    } finally {
      setBetfairHealthLoading(false);
    }
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
      .then(async (res) => {
        const payload = await res.json().catch(() => ({} as { error?: string; meets?: Meet[] }));
        if (!res.ok) {
          throw new Error(payload.error || 'Failed to load meets');
        }
        return payload;
      })
      .then((data) => {
        setMeets(normalizeMeetList(data.meets || []));
      })
      .catch((err) => {
        console.error(err);
        addNotification((err as Error).message || 'Unable to load meets. Check your API credentials and network.', 'error');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void runBetfairHealthCheck();
  }, []);

  useEffect(() => {
    if (user && globalMeets.length) {
      setSelectedMeets(globalMeets);
      const loadRacesSequentially = async () => {
        for (const meet of globalMeets) {
          if (!(races[meet.meet_id]?.length)) {
            await loadRacesForMeet(meet);
          }
        }
      };
      void loadRacesSequentially();
    }
  }, [user, isAdmin, globalMeets, activeScreen]);

  useEffect(() => {
    if (isAdmin) {
      setAdminSelectedMeets(globalMeets);
    }
  }, [isAdmin, globalMeets]);

  useEffect(() => {
    if (!isAdmin && activeScreen === 'admin') {
      setActiveScreen('main');
    }
  }, [isAdmin, activeScreen]);

  useEffect(() => {
    if (!user || !isAdmin || activeScreen !== 'main' || !globalMeets.length) {
      return;
    }

    const refreshAdminRaces = async () => {
      for (const meet of globalMeets) {
        await loadRacesForMeet(meet);
      }
    };

    void refreshAdminRaces();
  }, [user, isAdmin, activeScreen, globalMeets]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [activeScreen]);

  useEffect(() => {
    if (!user || activeScreen !== 'home') {
      return;
    }
    void loadRaceResults();
    void loadSubmissionRows();
  }, [user, activeScreen]);

  useEffect(() => {
    if (!manualResultRaceId || manualRunnersByRaceId[manualResultRaceId]) {
      return;
    }

    let active = true;
    const loadManualRunners = async () => {
      setManualRunnersLoading(true);
      try {
        const meetCandidates = meetsForPicks.length ? meetsForPicks : globalMeets;

        for (const meet of meetCandidates) {
          const candidateDates = Array.from(new Set([meet.date, getTodayDate()].filter(Boolean)));
          for (const date of candidateDates) {
            const res = await fetch(
              buildRacesUrl(meet.meet_id, date, meet.raceType)
            );
            if (!res.ok) {
              continue;
            }

            const data = await res.json() as { races?: Race[] };
            const race = (Array.isArray(data.races) ? data.races : []).find((item) => item.id === manualResultRaceId);
            if (!race || !Array.isArray(race.runners) || !race.runners.length) {
              continue;
            }

            const options = race.runners.map((runner) => ({
              horseId: runner.id,
              horseName: formatHorseDisplayName(runner.name, runner.number),
            }));

            if (!active) {
              return;
            }

            setManualRunnersByRaceId(prev => ({ ...prev, [manualResultRaceId]: options }));
            setRaceRunnersCache(prev => {
              const next = { ...prev, [manualResultRaceId]: options };
              void persistRaceRunnersCache(next);
              return next;
            });
            return;
          }
        }

        const runnerEndpoints = ['/api/results', '/api/market-runners'];
        for (const endpoint of runnerEndpoints) {
          const res = await fetch(`${endpoint}?marketId=${encodeURIComponent(manualResultRaceId)}`);
          if (!res.ok) {
            continue;
          }

          const data = await res.json() as { runners?: Array<{ id: string; name: string; number: number | null }> };
          const options = Array.isArray(data.runners)
            ? data.runners.map((runner) => ({
              horseId: runner.id,
              horseName: formatHorseDisplayName(runner.name, runner.number),
            }))
            : [];

          if (!active || !options.length) {
            continue;
          }

          setManualRunnersByRaceId(prev => ({ ...prev, [manualResultRaceId]: options }));
          setRaceRunnersCache(prev => {
            const next = { ...prev, [manualResultRaceId]: options };
            void persistRaceRunnersCache(next);
            return next;
          });
          return;
        }
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
  }, [manualResultRaceId, manualRunnersByRaceId, globalMeets, meetsForPicks]);

  useEffect(() => {
    if (!isAdmin || activeScreen !== 'submissions' || !resultsAutoRefresh || submissionRows.length === 0) {
      return;
    }

    const timer = setInterval(() => {
      if (resultsFetching) {
        return;
      }

      void fetchAndSaveResults().then(() => {
        setResultsLastRefreshedAt(new Date().toISOString());
      });
    }, 90000);

    return () => {
      clearInterval(timer);
    };
  }, [isAdmin, activeScreen, resultsAutoRefresh, submissionRows.length, resultsFetching]);

  const loadRacesForMeet = async (meet: Meet) => {
    setRaceLoading(prev => ({ ...prev, [meet.meet_id]: true }));

    try {
      const candidateDates = Array.from(new Set([meet.date, getTodayDate()].filter(Boolean)));
      let loadedRaces: Race[] = [];

      for (const date of candidateDates) {
        const res = await fetch(
          buildRacesUrl(meet.meet_id, date, meet.raceType)
        );
        if (!res.ok) {
          continue;
        }

        const data = await res.json() as { races?: Race[] };
        const nextRaces = Array.isArray(data.races) ? data.races : [];
        if (nextRaces.length) {
          loadedRaces = nextRaces;
          break;
        }
      }

      setRaces(prev => {
        const existing = prev[meet.meet_id] || [];
        // Avoid wiping already-loaded races if a later retry returns nothing.
        if (loadedRaces.length === 0 && existing.length > 0) {
          return prev;
        }
        return { ...prev, [meet.meet_id]: loadedRaces };
      });

      if (loadedRaces.length > 0) {
        const updates: RaceRunnersMap = {};
        loadedRaces.forEach((race) => {
          updates[race.id] = (race.runners || []).map((runner) => ({
            horseId: runner.id,
            horseName: formatHorseDisplayName(runner.name, runner.number),
          }));
        });

        if (Object.keys(updates).length) {
          setRaceRunnersCache(prev => {
            const next = { ...prev, ...updates };
            void persistRaceRunnersCache(next);
            return next;
          });
        }
      }

      setRaceExpanded(prev => {
        const next = { ...prev };
        loadedRaces.forEach((race: Race) => {
          const key = `${meet.meet_id}|${race.id}`;
          next[key] = true;
        });
        return next;
      });
    } catch (err) {
      console.error('loadRacesForMeet error', err);
      // Keep current races on transient fetch failures.
      setRaces(prev => prev);
    } finally {
      setRaceLoading(prev => ({ ...prev, [meet.meet_id]: false }));
    }
  };

  const selectMeet = async (meet: Meet) => {
    if (adminSelectedMeets.length >= 2 || adminSelectedMeets.some(m => m.meet_id === meet.meet_id)) {
      return;
    }

    setAdminSelectedMeets(prev => [...prev, meet]);
    setTimeout(() => {
      document.getElementById('races-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    await loadRacesForMeet(meet);
  };

  const removeSelectedMeet = (meetId: string) => {
    setAdminSelectedMeets((prev) => prev.filter((meet) => meet.meet_id !== meetId));
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

  const groupedMeetChoices = useMemo(() => {
    const groups: Record<'Thoroughbred' | 'Harness', Meet[]> = {
      Thoroughbred: [],
      Harness: [],
    };

    meets.forEach((meet) => {
      groups[normalizeMeetRaceType(meet.raceType)].push(meet);
    });

    groups.Thoroughbred.sort((a, b) => a.course.localeCompare(b.course));
    groups.Harness.sort((a, b) => a.course.localeCompare(b.course));

    return groups;
  }, [meets]);

  const loadRaceDebug = async (meet: Meet) => {
    try {
      const res = await fetch(buildRacesUrl(meet.meet_id, meet.date, meet.raceType, true));
      if (!res.ok) {
        throw new Error('Unable to load debug info');
      }
      const data = await res.json();
      setRaceDebug(prev => ({ ...prev, [meet.meet_id]: data.raw ?? data }));
    } catch (err) {
      console.error(err);
      addNotification('Unable to load debug info for selected meet.', 'error');
    }
  };

  const selectHorse = (meetId: string, raceId: string, raceName: string, horseId: string, horseName: string) => {
    const existing = selections.find(s => s.meetId === meetId && s.raceId === raceId);
    const meetCourse = meetsForPicks.find(m => m.meet_id === meetId)?.course ?? meetId;
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
          let points = 0;
          if (horseMatchesResult(sel.raceId, sel.horseId, sel.horseName, result?.winnerId, result?.winnerName)) points = 4;
          else if (horseMatchesResult(sel.raceId, sel.horseId, sel.horseName, result?.secondId, result?.secondName)) points = 2;
          else if (horseMatchesResult(sel.raceId, sel.horseId, sel.horseName, result?.thirdId, result?.thirdName)) points = 1;

          if (points > 0) {
            const isWild = row.wildcard?.meetId === sel.meetId && row.wildcard?.raceId === sel.raceId;
            score += isWild ? points * 2 : points;
          }
        });
        return { username: row.username, score };
      });
  }, [raceResults, submissionRows]);

  const rankedScoreboard = useMemo(() => rankScoreboard(scoreboard), [scoreboard]);

  const manualRaceOptions = useMemo(() => {
    const raceMap = new Map<string, { raceName: string; location: string; meetId: string | null }>();

    meetsForPicks.forEach(meet => {
      const location = meet.course ?? meet.meet_id;
      (races[meet.meet_id] || []).forEach(race => {
        if (!raceMap.has(race.id)) {
          raceMap.set(race.id, {
            raceName: race.name,
            location,
            meetId: meet.meet_id,
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
            location: sel.meetCourse ?? meetsForPicks.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId,
            meetId: sel.meetId,
          });
        }
      });
    });

    return [...raceMap.entries()]
      .map(([raceId, info]) => ({
        raceId,
        meetId: info.meetId,
        raceName: info.raceName,
        location: info.location,
        label: `${info.location} - ${info.raceName}`,
      }))
      .sort((a, b) => {
        const meetIndexDiff = getMeetSortIndex(a.meetId, a.location) - getMeetSortIndex(b.meetId, b.location);
        if (meetIndexDiff !== 0) return meetIndexDiff;

        const raceNumberDiff = extractRaceNumber(a.raceName) - extractRaceNumber(b.raceName);
        if (raceNumberDiff !== 0) return raceNumberDiff;

        return a.label.localeCompare(b.label);
      });
  }, [meetsForPicks, races, submissionRows]);

  const manualHorseOptions = useMemo(() => {
    if (!manualResultRaceId) return [] as Array<{ horseId: string; horseName: string }>;

    const isBadName = (name: string) => !name || isRunnerPlaceholderName(name);

    const candidates: Array<{ horseId: string; horseName: string; priority: number }> = [];
    const pushCandidate = (horseId: string, horseName: string, priority: number) => {
      const trimmedId = String(horseId || '').trim();
      const trimmedName = String(horseName || '').trim();
      if (!trimmedId || !trimmedName) return;
      candidates.push({ horseId: trimmedId, horseName: trimmedName, priority });
    };

    submissionRows.forEach((row) => {
      row.selections
        .filter((sel) => sel.raceId === manualResultRaceId)
        .forEach((sel) => pushCandidate(sel.horseId, sel.horseName, 400));
    });

    meetsForPicks.forEach((meet) => {
      const race = (races[meet.meet_id] || []).find((item) => item.id === manualResultRaceId);
      race?.runners.forEach((runner) => {
        pushCandidate(runner.id, formatHorseDisplayName(runner.name, runner.number), 300);
      });
    });

    (raceRunnersCache[manualResultRaceId] || []).forEach((runner) => {
      pushCandidate(runner.horseId, runner.horseName, 200);
    });

    (manualRunnersByRaceId[manualResultRaceId] || []).forEach((runner) => {
      pushCandidate(runner.horseId, runner.horseName, 100);
    });

    const existingResult = raceResults[manualResultRaceId];
    if (existingResult?.winnerId) {
      pushCandidate(existingResult.winnerId, resolveRaceHorseName(manualResultRaceId, existingResult.winnerId, existingResult.winnerName) || existingResult.winnerId, 350);
    }
    if (existingResult?.secondId) {
      pushCandidate(existingResult.secondId, resolveRaceHorseName(manualResultRaceId, existingResult.secondId, existingResult.secondName) || existingResult.secondId, 350);
    }
    if (existingResult?.thirdId) {
      pushCandidate(existingResult.thirdId, resolveRaceHorseName(manualResultRaceId, existingResult.thirdId, existingResult.thirdName) || existingResult.thirdId, 350);
    }

    const bestByKey = new Map<string, { horseId: string; horseName: string; priority: number }>();
    candidates.forEach((candidate) => {
      const horseNumber = extractHorseNumber(candidate.horseName);
      const normalizedName = normalizeHorseNameForComparison(candidate.horseName);
      const key = horseNumber !== null
        ? `number:${horseNumber}`
        : normalizedName
        ? `name:${normalizedName}`
        : `id:${candidate.horseId}`;

      const quality = candidate.priority + (isBadName(candidate.horseName) ? 0 : 1000);
      const existing = bestByKey.get(key);
      const existingQuality = existing ? existing.priority + (isBadName(existing.horseName) ? 0 : 1000) : -1;

      if (!existing || quality > existingQuality) {
        bestByKey.set(key, candidate);
      }
    });

    return [...bestByKey.values()]
      .map(({ horseId, horseName }) => ({ horseId, horseName }))
      .sort((a, b) => {
        const aNumber = extractHorseNumber(a.horseName);
        const bNumber = extractHorseNumber(b.horseName);
        if (aNumber !== null && bNumber !== null && aNumber !== bNumber) {
          return aNumber - bNumber;
        }
        return a.horseName.localeCompare(b.horseName);
      });
  }, [manualResultRaceId, manualRunnersByRaceId, raceRunnersCache, meetsForPicks, races, submissionRows, raceResults]);

  const manualHorseLabelById = useMemo(() => {
    return manualHorseOptions.reduce((acc, option) => {
      acc[option.horseId] = option.horseName;
      return acc;
    }, {} as Record<string, string>);
  }, [manualHorseOptions]);

  const isMissingHorseDetail = (value: string | null | undefined) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return true;
    if (/^\d+$/.test(trimmed)) return true;
    return isRunnerPlaceholderName(trimmed);
  };

  const getPreferredManualHorseName = (
    horseId: string,
    explicitName?: string | null,
    storedName?: string | null
  ) => {
    const candidates = [
      explicitName,
      manualHorseLabelById[horseId],
      storedName,
      resolveRaceHorseName(manualResultRaceId, horseId, storedName),
    ];

    for (const candidate of candidates) {
      const trimmed = String(candidate || '').trim();
      if (trimmed && !/^\d+$/.test(trimmed)) {
        return trimmed;
      }
    }

    return String(explicitName || manualHorseLabelById[horseId] || storedName || resolveRaceHorseName(manualResultRaceId, horseId, storedName) || horseId || '').trim();
  };

  const rankByUsername = useMemo(() => {
    const map = new Map<string, number>();
    rankedScoreboard.forEach((entry) => {
      map.set(entry.username, entry.rank);
    });
    return map;
  }, [rankedScoreboard]);

  const podiumGroups = useMemo(() => {
    const groups = new Map<number, PodiumGroup>();

    rankedScoreboard.forEach((entry) => {
      if (entry.rank > 3) return;

      const existing = groups.get(entry.rank);
      if (existing) {
        existing.entries.push(entry);
        return;
      }

      groups.set(entry.rank, {
        rank: entry.rank,
        score: entry.score,
        entries: [entry],
      });
    });

    return {
      first: groups.get(1) ?? null,
      second: groups.get(2) ?? null,
      third: groups.get(3) ?? null,
    };
  }, [rankedScoreboard]);

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

  const wildcardOptions = useMemo(() => selections.sort((a, b) => {
    const raceNumA = parseInt(a.raceName?.match(/R(\d+)/)?.[1] ?? '0', 10);
    const raceNumB = parseInt(b.raceName?.match(/R(\d+)/)?.[1] ?? '0', 10);
    return raceNumA - raceNumB;
  }).map(sel => {
    const course = meetsForPicks.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId;
    const race = races[sel.meetId]?.find(r => r.id === sel.raceId);
    const runner = race?.runners.find(r => r.id === sel.horseId);
    const oddsLabel = runner?.odds ? ` - $${runner.odds}` : '';

    return {
      value: `${sel.meetId}|${sel.raceId}`,
      label: `${sel.horseName}${oddsLabel} ; (${sel.raceName} @ ${course})`,
    };
  }), [selections, meetsForPicks, races]);

  const getSelectionLocation = (sel: Selection) => {
    return sel.meetCourse ?? meetsForPicks.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId;
  };

  const runnerNameByRaceId = useMemo(() => {
    const map = new Map<string, Map<string, string>>();

    const setRunner = (raceId: string, horseId: string, horseName: string) => {
      if (!raceId || !horseId || !horseName) return;
      if (!map.has(raceId)) {
        map.set(raceId, new Map<string, string>());
      }
      const existing = map.get(raceId)?.get(horseId);
      const shouldReplace = !existing || (isRunnerPlaceholderName(existing) && !isRunnerPlaceholderName(horseName));
      if (shouldReplace) {
        map.get(raceId)?.set(horseId, horseName);
      }
    };

    Object.entries(raceRunnersCache).forEach(([raceId, runners]) => {
      (runners || []).forEach((runner) => {
        setRunner(raceId, runner.horseId, runner.horseName);
      });
    });

    Object.values(races).forEach((raceList) => {
      (raceList || []).forEach((race) => {
        (race.runners || []).forEach((runner) => {
          const name = formatHorseDisplayName(runner.name, runner.number);
          setRunner(race.id, runner.id, name);
        });
      });
    });

    submissionRows.forEach((row) => {
      row.selections.forEach((sel) => {
        setRunner(sel.raceId, sel.horseId, sel.horseName);
      });
    });

    Object.entries(raceResults).forEach(([raceId, result]) => {
      if (result.winnerId && result.winnerName) {
        setRunner(raceId, result.winnerId, result.winnerName);
      }
      if (result.secondId && result.secondName) {
        setRunner(raceId, result.secondId, result.secondName);
      }
      if (result.thirdId && result.thirdName) {
        setRunner(raceId, result.thirdId, result.thirdName);
      }
    });

    return map;
  }, [raceRunnersCache, races, submissionRows, raceResults]);

  const activeSelections = hasSubmitted && submittedSelections ? submittedSelections.selections : selections;
  const activeWildcard = hasSubmitted && submittedSelections ? submittedSelections.wildcard : wildcard;

  const myRaceResults = useMemo(() => {
    return activeSelections.map((sel) => {
      const result = raceResults[sel.raceId];
      const isWildcardPick = activeWildcard?.meetId === sel.meetId && activeWildcard?.raceId === sel.raceId;
      const isSettled = Boolean(result?.winnerId || result?.secondId || result?.thirdId);
      const isWinner = horseMatchesResult(sel.raceId, sel.horseId, sel.horseName, result?.winnerId, result?.winnerName);
      const isSecond = horseMatchesResult(sel.raceId, sel.horseId, sel.horseName, result?.secondId, result?.secondName);
      const isThird = horseMatchesResult(sel.raceId, sel.horseId, sel.horseName, result?.thirdId, result?.thirdName);
      const winnerFallback = result?.winnerId ? runnerNameByRaceId.get(sel.raceId)?.get(result.winnerId) ?? null : null;
      const secondFallback = result?.secondId ? runnerNameByRaceId.get(sel.raceId)?.get(result.secondId) ?? null : null;
      const thirdFallback = result?.thirdId ? runnerNameByRaceId.get(sel.raceId)?.get(result.thirdId) ?? null : null;
      const resolvedWinnerName = result?.winnerId
        ? preferResolvedHorseName(result.winnerName, winnerFallback, result.winnerId)
        : null;
      const resolvedSecondName = result?.secondId
        ? preferResolvedHorseName(result.secondName, secondFallback, result.secondId)
        : null;
      const resolvedThirdName = result?.thirdId
        ? preferResolvedHorseName(result.thirdName, thirdFallback, result.thirdId)
        : null;

      return {
        ...sel,
        isWildcardPick,
        isSettled,
        isWinner,
        isSecond,
        isThird,
        winnerId: result?.winnerId ?? null,
        winnerName: resolvedWinnerName,
        secondId: result?.secondId ?? null,
        secondName: resolvedSecondName,
        thirdId: result?.thirdId ?? null,
        thirdName: resolvedThirdName,
      };
    });
  }, [activeSelections, activeWildcard, raceResults, runnerNameByRaceId]);

  const myRaceResultsPanel = (
    <section className="mb-10 rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Race Results for Your Picks</h3>
        <span className="text-xs text-slate-500">
          Settled: {myRaceResults.filter((item) => item.isSettled).length}/{myRaceResults.length}
        </span>
      </div>

      {myRaceResults.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Make your race selections first to see result status here.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {myRaceResults.sort((a, b) => {
            const raceNumA = parseInt(a.raceName?.match(/R(\d+)/)?.[1] ?? '0', 10);
            const raceNumB = parseInt(b.raceName?.match(/R(\d+)/)?.[1] ?? '0', 10);
            return raceNumA - raceNumB;
          }).map((item) => (
            <li key={`my-result-${item.meetId}-${item.raceId}`} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">
                  {getSelectionLocation(item)} - {item.raceName}
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    !item.isSettled
                      ? 'bg-amber-100 text-amber-700'
                      : item.isWinner
                      ? 'bg-green-100 text-green-700'
                      : item.isSecond
                      ? 'bg-blue-100 text-blue-700'
                      : item.isThird
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {!item.isSettled
                    ? 'Pending'
                    : item.isWinner
                    ? '1st Place'
                    : item.isSecond
                    ? '2nd Place'
                    : item.isThird
                    ? '3rd Place'
                    : 'Unplaced'}
                </span>
              </div>
              <p className="mt-1 text-slate-700">
                Your pick: {item.horseName}
                {item.isWildcardPick ? ' (Wildcard)' : ''}
              </p>
              <p className="mt-1 text-slate-600">1st: {item.winnerName ?? item.winnerId ?? 'Waiting for result'}</p>
              <p className="mt-1 flex items-center gap-1 text-slate-600">
                2nd: {item.secondName ?? item.secondId ?? 'TBC'}
                {item.secondId && raceResults[item.raceId]?.inferredPlaces && (
                  <span className="inline-block rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-700">Auto</span>
                )}
              </p>
              <p className="mt-1 flex items-center gap-1 text-slate-600">
                3rd: {item.thirdName ?? item.thirdId ?? 'TBC'}
                {item.thirdId && raceResults[item.raceId]?.inferredPlaces && (
                  <span className="inline-block rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-700">Auto</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

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
      const winnerFallback = result.winnerId ? runnerNameByRaceId.get(raceId)?.get(result.winnerId) ?? null : null;
      const secondFallback = result.secondId ? runnerNameByRaceId.get(raceId)?.get(result.secondId) ?? null : null;
      const thirdFallback = result.thirdId ? runnerNameByRaceId.get(raceId)?.get(result.thirdId) ?? null : null;
      const resolvedWinnerName = result.winnerId
        ? preferResolvedHorseName(result.winnerName, winnerFallback, result.winnerId)
        : null;
      const resolvedSecondName = result.secondId
        ? preferResolvedHorseName(result.secondName, secondFallback, result.secondId)
        : null;
      const resolvedThirdName = result.thirdId
        ? preferResolvedHorseName(result.thirdName, thirdFallback, result.thirdId)
        : null;
      return {
        raceId,
        raceName: meta?.raceName || raceId,
        location: meta?.location || 'Unknown Meet',
        winnerName: resolvedWinnerName,
        secondName: resolvedSecondName,
        thirdName: resolvedThirdName,
        inferredPlaces: result.inferredPlaces ?? false,
      };
    });
  }, [raceResults, submissionRows, runnerNameByRaceId]);

  const homeScoreboard =
    previousRoundSnapshot?.scoreboard?.length ? previousRoundSnapshot.scoreboard : scoreboard;

  const homeRankedScoreboard = useMemo(() => rankScoreboard(homeScoreboard), [homeScoreboard]);

  const homeLastRoundRaceResults =
    previousRoundSnapshot?.results?.length ? previousRoundSnapshot.results : lastRoundRaceResults;

  const homePreviousMeetLabel =
    previousRoundSnapshot?.meets?.length
      ? previousRoundSnapshot.meets.map((meet) => `${meet.course} (${meet.date})`).join(' • ')
      : null;

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
        {homeRankedScoreboard.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No scored results yet for the current round.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {homeRankedScoreboard.map((entry) => (
              <li key={`home-score-${entry.username}`} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium">#{entry.rank} {entry.username}</span>
                <span className="font-semibold text-slate-700">{entry.score} pt{entry.score !== 1 ? 's' : ''}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h3 className="text-lg font-semibold">Last Round Results</h3>
        {homePreviousMeetLabel ? (
          <p className="mt-2 text-xs text-slate-500">Previous meets: {homePreviousMeetLabel}</p>
        ) : null}
        {homeLastRoundRaceResults.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Race results are not available yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {homeLastRoundRaceResults.map((result) => (
              <li key={`home-result-${result.raceId}`} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium">{result.location} - {result.raceName}</span>
                <span className="ml-2 text-slate-700">1st: {result.winnerName || 'TBC'}</span>
                <span className="ml-2 flex items-center gap-1 text-slate-700">
                  2nd: {result.secondName || 'TBC'}
                  {result.secondName && result.inferredPlaces && (
                    <span className="inline-block rounded bg-sky-100 px-1 py-0.5 text-xs font-medium text-sky-700">Auto</span>
                  )}
                </span>
                <span className="ml-2 flex items-center gap-1 text-slate-700">
                  3rd: {result.thirdName || 'TBC'}
                  {result.thirdName && result.inferredPlaces && (
                    <span className="inline-block rounded bg-sky-100 px-1 py-0.5 text-xs font-medium text-sky-700">Auto</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );

  const versionBadge = (
    <div className="fixed bottom-20 right-3 z-30 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] text-slate-600 shadow-sm backdrop-blur lg:bottom-4">
      <span>&copy; {APP_VERSION_LABEL}</span>
    </div>
  );

  const submitConfirmationModal = showSubmitConfirm ? (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto">
        <h3 className="text-lg font-semibold mb-2">Confirm Your Selections</h3>
        <p className="text-sm text-slate-600 mb-4">
          You are about to submit {selections.length} selection{selections.length === 1 ? '' : 's'}. You will not be able to edit after submitting.
        </p>

        <ul className="space-y-2 mb-4">
          {selections.sort((a, b) => {
            const raceNumA = parseInt(a.raceName?.match(/R(\d+)/)?.[1] ?? '0', 10);
            const raceNumB = parseInt(b.raceName?.match(/R(\d+)/)?.[1] ?? '0', 10);
            return raceNumA - raceNumB;
          }).map(sel => (
            <li key={`confirm-${sel.meetId}-${sel.raceId}`} className="rounded-lg bg-slate-50 p-3 text-sm">
              <span className="font-medium">{meetsForPicks.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId}</span> Race {sel.raceId}: {sel.horseName}{' '}
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
            onClick={() => {
              void fetchAndSaveResults().then(() => {
                setResultsLastRefreshedAt(new Date().toISOString());
              });
            }}
            disabled={resultsFetching || submissionRows.length === 0}
            className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {resultsFetching ? 'Fetching...' : 'Fetch Results'}
          </button>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={resultsAutoRefresh}
              onChange={(e) => setResultsAutoRefresh(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Auto-refresh every 90 seconds
          </label>
          {resultsLastRefreshedAt ? (
            <p className="text-xs text-slate-500">
              Last results refresh: {new Date(resultsLastRefreshedAt).toLocaleTimeString()}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm lg:flex-row lg:items-center">
            <select
              value={manualResultRaceId}
              onChange={(e) => {
                const raceId = e.target.value;
                setManualResultRaceId(raceId);
                const existing = raceResults[raceId];
                setManualResultHorseId(existing?.winnerId || '');
                setManualResultSecondHorseId(existing?.secondId || '');
                setManualResultThirdHorseId(existing?.thirdId || '');
                setManualResultHorseName(existing?.winnerName || '');
                setManualResultSecondHorseName(existing?.secondName || '');
                setManualResultThirdHorseName(existing?.thirdName || '');
                setManualApplyNotice(null);
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
              onChange={(e) => {
                const nextId = e.target.value;
                setManualResultHorseId(nextId);
                setManualResultHorseName(nextId ? getPreferredManualHorseName(nextId) : '');
              }}
              disabled={!manualResultRaceId || manualRunnersLoading}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="">{manualRunnersLoading ? 'Loading horses...' : 'Select winner (1st)'}</option>
              {manualHorseOptions.map(opt => (
                <option key={`first-${opt.horseId}`} value={opt.horseId}>{opt.horseName}</option>
              ))}
            </select>
            <select
              value={manualResultSecondHorseId}
              onChange={(e) => {
                const nextId = e.target.value;
                setManualResultSecondHorseId(nextId);
                setManualResultSecondHorseName(nextId ? getPreferredManualHorseName(nextId) : '');
              }}
              disabled={!manualResultRaceId || manualRunnersLoading}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="">{manualRunnersLoading ? 'Loading horses...' : 'Select 2nd place'}</option>
              {manualHorseOptions.map(opt => (
                <option key={`second-${opt.horseId}`} value={opt.horseId}>{opt.horseName}</option>
              ))}
            </select>
            <select
              value={manualResultThirdHorseId}
              onChange={(e) => {
                const nextId = e.target.value;
                setManualResultThirdHorseId(nextId);
                setManualResultThirdHorseName(nextId ? getPreferredManualHorseName(nextId) : '');
              }}
              disabled={!manualResultRaceId || manualRunnersLoading}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="">{manualRunnersLoading ? 'Loading horses...' : 'Select 3rd place'}</option>
              {manualHorseOptions.map(opt => (
                <option key={`third-${opt.horseId}`} value={opt.horseId}>{opt.horseName}</option>
              ))}
            </select>
            <input
              value={manualResultHorseName}
              onChange={(e) => setManualResultHorseName(e.target.value)}
              placeholder="Winner horse name"
              disabled={!manualResultHorseId}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            />
            <input
              value={manualResultSecondHorseName}
              onChange={(e) => setManualResultSecondHorseName(e.target.value)}
              placeholder="2nd place horse name"
              disabled={!manualResultSecondHorseId}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            />
            <input
              value={manualResultThirdHorseName}
              onChange={(e) => setManualResultThirdHorseName(e.target.value)}
              placeholder="3rd place horse name"
              disabled={!manualResultThirdHorseId}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            />
            <button
              onClick={() => { void applyManualResult(); }}
              disabled={!manualResultRaceId || (!manualResultHorseId && !manualResultSecondHorseId && !manualResultThirdHorseId)}
              className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Apply Manual Placings
            </button>
          </div>
          {manualApplyNotice ? (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {manualApplyNotice}
            </div>
          ) : null}
        </div>
      ) : null}
      {rankedScoreboard.length > 0 ? (
        <div className="mb-6 rounded-lg bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Leaderboard</h3>
          <ol className="space-y-1">
            {rankedScoreboard.map((entry) => (
              <li key={entry.username} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className={`w-6 text-center font-bold ${podiumTextClass(entry.rank)}`}>{entry.rank}</span>
                  <span className="font-medium">{entry.username}</span>
                </span>
                <span className={`font-bold ${podiumTextClass(entry.rank)}`}>{entry.score} pt{entry.score !== 1 ? 's' : ''}</span>
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
            const rowScore = rankedScoreboard.find(e => e.username === row.username)?.score ?? null;
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
                      {[...row.selections].sort(compareSelectionsByMeetAndRace).map((sel, idx) => {
                        const isWildcard = row.wildcard?.meetId === sel.meetId && row.wildcard?.raceId === sel.raceId;
                        const result = raceResults[sel.raceId];
                        const isWinner = horseMatchesResult(sel.raceId, sel.horseId, sel.horseName, result?.winnerId, result?.winnerName);
                        const resolvedWinnerName = result?.winnerId
                          ? preferResolvedHorseName(result.winnerName, resolveRaceHorseName(sel.raceId, result.winnerId, result.winnerName), result.winnerId)
                          : null;
                        return (
                          <li key={`${row.user_id}-${sel.meetId}-${sel.raceId}-${idx}`} className={`rounded px-2 py-0.5 ${isWinner ? 'bg-green-100 text-green-900 font-semibold' : isWildcard ? 'bg-yellow-100 text-yellow-900 font-semibold' : ''}`}>
                            <div>
                              {getSelectionLocation(sel)} - {sel.raceName}: {sel.horseName}
                              {isWildcard ? ' \u2b50 Wildcard' : ''}
                              {isWinner ? ' \u2705' : (result && !isWinner ? ' \u274c' : '')}
                            </div>
                            {resolvedWinnerName ? (
                              <div className="mt-1 text-xs font-normal text-slate-600">
                                Winner: {resolvedWinnerName}
                              </div>
                            ) : null}
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

  const leaderboardContent = (
    <section className="mb-10">
      <div className="mb-8">
        <div className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 p-6 text-white">
          <h2 className="text-2xl font-bold mb-2">Current Race Day Standings</h2>
          <p className="text-sm text-purple-100">
            {globalMeets.length > 0
              ? globalMeets.map((m) => `${m.course} (${m.date})`).join(' • ')
              : 'No meets selected'}
          </p>
        </div>
      </div>

      {scoreboard.length === 0 ? (
        <div className="rounded-lg bg-white p-8 shadow-sm text-center">
          <p className="text-slate-500">No race results yet. Check back once races are submitted.</p>
        </div>
      ) : (
        <div className="mt-8 px-0 sm:px-4">
          <div className="grid gap-4 md:mt-12 md:grid-cols-3 md:items-end">
            {[
              {
                key: 'second',
                group: podiumGroups.second,
                rank: 2,
                orderClass: 'order-2 md:order-1',
                cardClass: 'border-2 border-slate-400 bg-slate-100',
                headerClass: 'bg-slate-400 text-white',
                scoreClass: 'text-slate-700',
                nameClass: 'text-slate-900',
                subtextClass: 'text-slate-600',
                pillarClass: 'hidden border-2 border-slate-400 border-t-0 bg-slate-300 md:block md:h-24',
                emptyCardClass: 'border-2 border-dashed border-slate-300 bg-slate-100 opacity-50',
                emptyHeaderClass: 'bg-slate-300 text-slate-500',
                emptyPillarClass: 'hidden border-2 border-dashed border-slate-300 border-t-0 bg-slate-200 md:block md:h-24',
                icon: '🥈',
              },
              {
                key: 'first',
                group: podiumGroups.first,
                rank: 1,
                orderClass: 'order-1 md:order-2',
                cardClass: 'border-4 border-yellow-400 bg-yellow-100',
                headerClass: 'bg-yellow-400 text-white',
                scoreClass: 'text-yellow-600',
                nameClass: 'text-yellow-900',
                subtextClass: 'text-yellow-700',
                pillarClass: 'hidden border-4 border-yellow-400 border-t-0 bg-yellow-300 md:block md:h-32',
                emptyCardClass: 'border-4 border-dashed border-yellow-300 bg-yellow-50 opacity-50',
                emptyHeaderClass: 'bg-yellow-300 text-yellow-600',
                emptyPillarClass: 'hidden border-4 border-dashed border-yellow-300 border-t-0 bg-yellow-200 md:block md:h-32',
                icon: '🥇',
              },
              {
                key: 'third',
                group: podiumGroups.third,
                rank: 3,
                orderClass: 'order-3 md:order-3',
                cardClass: 'border-2 border-amber-700 bg-amber-100',
                headerClass: 'bg-amber-700 text-white',
                scoreClass: 'text-amber-700',
                nameClass: 'text-amber-900',
                subtextClass: 'text-amber-800',
                pillarClass: 'hidden border-2 border-amber-700 border-t-0 bg-amber-600 md:block md:h-16',
                emptyCardClass: 'border-2 border-dashed border-amber-600 bg-amber-50 opacity-50',
                emptyHeaderClass: 'bg-amber-600 text-amber-200',
                emptyPillarClass: 'hidden border-2 border-dashed border-amber-600 border-t-0 bg-amber-500 md:block md:h-16',
                icon: '🥉',
              },
            ].map((slot) => {
              const placeLabel = `${formatRankLabel(slot.rank)} Place`;

              if (!slot.group) {
                return (
                  <div key={slot.key} className={`${slot.orderClass} md:mx-auto md:w-48`}>
                    <div className={`overflow-hidden rounded-t-lg ${slot.emptyCardClass}`}>
                      <div className={`p-4 text-center ${slot.emptyHeaderClass}`}>
                        <p className="text-2xl font-bold">—</p>
                        <p className="text-sm font-semibold">{placeLabel}</p>
                      </div>
                      <div className="p-6 text-center">
                        <p className="text-lg font-bold text-slate-400">TBC</p>
                      </div>
                    </div>
                    <div className={slot.emptyPillarClass}></div>
                  </div>
                );
              }

              return (
                <div key={slot.key} className={`${slot.orderClass} md:mx-auto md:w-48`}>
                  <div className={`overflow-hidden rounded-t-lg ${slot.cardClass}`}>
                    <div className={`p-4 text-center ${slot.headerClass}`}>
                      <p className={`font-bold ${slot.rank === 1 ? 'text-3xl' : 'text-2xl'}`}>{slot.icon}</p>
                      <p className="text-sm font-semibold">
                        {slot.group.entries.length > 1 ? `Tied ${placeLabel}` : placeLabel}
                      </p>
                    </div>
                    <div className="p-5 text-center">
                      <div className="space-y-2">
                        {slot.group.entries.map((entry) => (
                          <div key={`${slot.key}-${entry.username}`} className="rounded-lg bg-white/50 px-3 py-2">
                            <p className={`text-lg font-bold ${slot.nameClass}`}>{entry.username}</p>
                          </div>
                        ))}
                      </div>
                      <p className={`mt-4 font-bold ${slot.rank === 1 ? 'text-4xl' : 'text-3xl'} ${slot.scoreClass}`}>{slot.group.score}</p>
                      <p className={`mt-1 text-xs ${slot.subtextClass}`}>points</p>
                    </div>
                  </div>
                  <div className={slot.pillarClass}></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rankedScoreboard.some((entry) => entry.rank > 3) && (
        <div className="mt-12 rounded-lg bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4">Other Competitors</h3>
          <ol className="space-y-2">
            {rankedScoreboard.filter((entry) => entry.rank > 3).map((entry) => (
              <li key={entry.username} className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center font-bold text-slate-600">#{entry.rank}</span>
                  <span className="font-medium text-slate-900">{entry.username}</span>
                </div>
                <span className="font-semibold text-slate-700">{entry.score} pt{entry.score !== 1 ? 's' : ''}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );

  const betfairStatusPanel = (
    <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Betfair Connection Status</h2>
          <p className="text-xs text-slate-500">Live health check for app key, session token, and AU horse market visibility.</p>
        </div>
        <button
          onClick={() => {
            void runBetfairHealthCheck();
          }}
          disabled={betfairHealthLoading}
          className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {betfairHealthLoading ? 'Checking...' : 'Refresh Status'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-semibold ${betfairHealth?.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
          {betfairHealth?.ok ? 'API Reachable' : 'API Error'}
        </span>
        <span className={`rounded-full px-2.5 py-1 font-semibold ${betfairHealth?.env?.appKeyConfigured ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
          App Key: {betfairHealth?.env?.appKeyConfigured ? 'Set' : 'Missing'}
        </span>
        <span className={`rounded-full px-2.5 py-1 font-semibold ${betfairHealth?.env?.sessionTokenConfigured ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
          Session Token: {betfairHealth?.env?.sessionTokenConfigured ? 'Set' : 'Missing'}
        </span>
        <span className={`rounded-full px-2.5 py-1 font-semibold ${betfairHealth?.auth?.autoLoginConfigured ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
          Auto-login: {betfairHealth?.auth?.autoLoginConfigured ? 'Enabled' : 'Off'}
        </span>
        <span className={`rounded-full px-2.5 py-1 font-semibold ${betfairHealth?.auth?.autoLoginUsedDuringCheck ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          Token refresh this check: {betfairHealth?.auth?.autoLoginUsedDuringCheck ? 'Yes' : 'No'}
        </span>
        {betfairHealthCheckedAt ? (
          <span className="text-slate-500">Last checked: {new Date(betfairHealthCheckedAt).toLocaleTimeString()}</span>
        ) : null}
      </div>

      {betfairHealth?.auth?.lastAutoLoginAt ? (
        <p className="mt-2 text-xs text-slate-500">
          Last token refresh: {new Date(betfairHealth.auth.lastAutoLoginAt).toLocaleTimeString()}
        </p>
      ) : null}

      {betfairHealthError ? (
        <p className="mt-3 text-sm text-red-600">{betfairHealthError}</p>
      ) : null}

      {betfairHealth?.checks ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <p className="text-slate-500">Event Types</p>
            <p className="text-sm font-semibold text-slate-900">{betfairHealth.checks.eventTypeCount}</p>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <p className="text-slate-500">Competitions</p>
            <p className="text-sm font-semibold text-slate-900">{betfairHealth.checks.competitionCount}</p>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <p className="text-slate-500">Markets</p>
            <p className="text-sm font-semibold text-slate-900">{betfairHealth.checks.marketCount}</p>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <p className="text-slate-500">With Competition</p>
            <p className="text-sm font-semibold text-slate-900">{betfairHealth.checks.marketWithCompetitionCount}</p>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <p className="text-slate-500">With Event</p>
            <p className="text-sm font-semibold text-slate-900">{betfairHealth.checks.marketWithEventCount}</p>
          </div>
        </div>
      ) : null}

      {betfairHealth?.samples?.firstMarket ? (
        <p className="mt-3 text-xs text-slate-600">
          Sample market: <span className="font-medium">{betfairHealth.samples.firstMarket.marketName}</span>
          {betfairHealth.samples.firstMarket.eventName ? ` (${betfairHealth.samples.firstMarket.eventName})` : ''}
        </p>
      ) : null}
    </section>
  );

  const notificationContainer = (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {notifications.map(notification => {
        const bgColor = 
          notification.type === 'success' ? 'bg-emerald-50 border-emerald-200' :
          notification.type === 'error' ? 'bg-red-50 border-red-200' :
          notification.type === 'warning' ? 'bg-amber-50 border-amber-200' :
          'bg-blue-50 border-blue-200';
        
        const textColor = 
          notification.type === 'success' ? 'text-emerald-800' :
          notification.type === 'error' ? 'text-red-800' :
          notification.type === 'warning' ? 'text-amber-800' :
          'text-blue-800';
        
        const iconEmoji = 
          notification.type === 'success' ? '✓' :
          notification.type === 'error' ? '✕' :
          notification.type === 'warning' ? '⚠' :
          'ℹ';

        return (
          <div
            key={notification.id}
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-sm animate-in ${bgColor}`}
            role="alert"
          >
            <span className={`text-lg font-bold ${textColor}`}>{iconEmoji}</span>
            <p className={`flex-1 text-sm ${textColor}`}>{notification.message}</p>
            <button
              onClick={() => removeNotification(notification.id)}
              className={`text-lg font-bold hover:opacity-70 ${textColor}`}
              aria-label="Close notification"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
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
        {versionBadge}
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
                onClick={() => setActiveScreen('leaderboard')}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${activeScreen === 'leaderboard' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} ${sidebarCollapsed ? 'lg:text-center' : ''}`}
              >
                <span className={sidebarCollapsed ? 'lg:hidden' : ''}>Leaderboard</span>
                <span className={`hidden ${sidebarCollapsed ? 'lg:inline' : ''}`}>L</span>
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
                {activeScreen === 'leaderboard' && 'Leaderboard'}
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

          {betfairStatusPanel}

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
                  disabled={adminSelectedMeets.length !== 2}
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

            <div className="mt-4 space-y-5">
              {(['Thoroughbred', 'Harness'] as const).map((type) => {
                const typedMeets = groupedMeetChoices[type];
                if (!typedMeets.length) {
                  return null;
                }

                return (
                  <div key={`group-${type}`}>
                    <h3 className="mb-3 text-sm font-semibold text-slate-700">{type} Meets</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {typedMeets.map((meet) => {
                        const isSelectedMeet = adminSelectedMeets.some((m) => m.meet_id === meet.meet_id);
                        return (
                          <div
                            key={meet.meet_id}
                            className={`p-4 rounded-lg shadow-sm ${
                              isSelectedMeet ? 'bg-emerald-50 border border-emerald-200' : 'bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="text-lg font-semibold">{meet.course} ({meet.state})</h4>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${type === 'Harness' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'}`}>
                                {type}
                              </span>
                            </div>
                            <p className="text-sm text-slate-500">{meet.date}</p>
                            <button
                              onClick={() => {
                                if (isSelectedMeet) {
                                  removeSelectedMeet(meet.meet_id);
                                  return;
                                }

                                void selectMeet(meet);
                              }}
                              disabled={adminSelectedMeets.length >= 2 && !isSelectedMeet}
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
                  </div>
                );
              })}
            </div>

            {globalMeets.length ? (
              <div className="mt-6 rounded-lg bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-700">Current Global Meets</h3>
                <ul className="mt-2 text-sm text-slate-600">
                  {globalMeets.map(m => (
                    <li key={m.meet_id}>{m.course} ({m.date}) - {normalizeMeetRaceType(m.raceType)}</li>
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

          {activeScreen === 'main' && meetsForPicks.length > 0 && (
            <section className="mb-10">
              <div className="mb-8">
                <h2 className="text-xl font-semibold">Global Meets</h2>

                {meetsForPicks.length === 0 ? (
                  <div className="mt-4 rounded-lg bg-white p-6 shadow-sm">
                    <p className="text-sm text-slate-600">Waiting for an admin to select the two race meets for this session.</p>
                    <p className="mt-2 text-sm text-slate-500">Once meets are published, they will appear here automatically.</p>
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {meetsForPicks.map(meet => (
                      <div key={`admin-main-meet-${meet.meet_id}`} className="bg-white p-4 rounded-lg shadow-sm">
                        <h3 className="text-lg font-semibold">{meet.course} ({meet.state})</h3>
                        <p className="text-sm text-slate-500">{meet.date}</p>
                        <p className="text-xs text-slate-500">{normalizeMeetRaceType(meet.raceType)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

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
                {meetsForPicks.map(meet => (
                  <div key={meet.meet_id} className="mb-10">
                    <h3 className="text-lg font-semibold mb-3">{meet.course} - Last 4 Races</h3>
                    {raceLoading[meet.meet_id] ? (
                      <div className="rounded-lg bg-white p-4 shadow-sm">
                        <p className="text-sm text-slate-500">Loading races...</p>
                      </div>
                    ) : (races[meet.meet_id] || []).length === 0 ? (
                      <div className="rounded-lg bg-white p-6 shadow-sm">
                        <p className="text-sm text-slate-600">No races were found for this meet.</p>
                        <button
                          onClick={() => {
                            void loadRacesForMeet(meet);
                          }}
                          className="mt-4 inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
                        >
                          Retry Loading Races
                        </button>
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
                    selections.sort((a, b) => {
                      const raceNumA = parseInt(a.raceName?.match(/R(\d+)/)?.[1] ?? '0', 10);
                      const raceNumB = parseInt(b.raceName?.match(/R(\d+)/)?.[1] ?? '0', 10);
                      return raceNumA - raceNumB;
                    }).map(sel => (
                      <li key={`${sel.meetId}-${sel.raceId}`} className="rounded-lg bg-white p-3 shadow-sm">
                        <span className="font-medium">{meetsForPicks.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId}</span> Race {sel.raceId}: {sel.horseName}{' '}
                        {wildcard?.meetId === sel.meetId && wildcard?.raceId === sel.raceId ? (
                          <span className="text-sm font-semibold text-emerald-600">(Wildcard)</span>
                        ) : null}
                      </li>
                    ))
                  )}
                </ul>
              </section>

              {myRaceResultsPanel}
            </section>
          )}

          {activeScreen === 'submissions' ? submissionsContent : null}

          {activeScreen === 'leaderboard' ? leaderboardContent : null}

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
        {versionBadge}
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
          <button onClick={() => setActiveScreen('leaderboard')} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${activeScreen === 'leaderboard' ? 'text-blue-600' : 'text-slate-500'}`}>
            <span className="text-xl leading-none">🏆</span>
            <span>Leaderboard</span>
          </button>
          <button onClick={() => setActiveScreen('submissions')} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${activeScreen === 'submissions' ? 'text-blue-600' : 'text-slate-500'}`}>
            <span className="text-xl leading-none">📋</span>
            <span>Submissions</span>
          </button>
        </nav>
        {notificationContainer}
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

        {betfairStatusPanel}

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
                  <p className="text-xs text-slate-500">{normalizeMeetRaceType(meet.raceType)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div id="races-section">
          {meetsForPicks.map(meet => (
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
              selections.sort((a, b) => {
                const raceNumA = parseInt(a.raceName?.match(/R(\d+)/)?.[1] ?? '0', 10);
                const raceNumB = parseInt(b.raceName?.match(/R(\d+)/)?.[1] ?? '0', 10);
                return raceNumA - raceNumB;
              }).map(sel => (
                <li key={`${sel.meetId}-${sel.raceId}`} className="rounded-lg bg-white p-3 shadow-sm">
                  <span className="font-medium">{meetsForPicks.find(m => m.meet_id === sel.meetId)?.course ?? sel.meetId}</span> Race {sel.raceId}: {sel.horseName}{' '}
                  {wildcard?.meetId === sel.meetId && wildcard?.raceId === sel.raceId ? (
                    <span className="text-sm font-semibold text-emerald-600">(Wildcard)</span>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </section>

        {myRaceResultsPanel}

        {meetsForPicks.length > 0 && (
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

          {activeScreen === 'leaderboard' ? leaderboardContent : null}

        {versionBadge}
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
            onClick={() => setActiveScreen('leaderboard')}
            className={`flex-1 py-3 flex flex-col items-center gap-0.5 text-xs font-medium ${
              activeScreen === 'leaderboard' ? 'text-blue-600' : 'text-slate-500'
            }`}
          >
            <span className="text-lg">🏆</span>
            <span>Leaderboard</span>
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
      {notificationContainer}
    </div>
  );
}

