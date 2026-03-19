import { useState, useCallback } from "react";

export interface Session {
  id: string;
  avg: number;
  min: number;
  max: number;
  duration: number;
  createdAt: string;
  timestamp?: number;
  avgNeck?: number;
  avgShoulder?: number;
  avgSpine?: number;
  avgHeadRoll?: number;
}

const STORAGE_KEY = "postureai_sessions_v2";

function loadAll(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session[]) : [];
  } catch {
    return [];
  }
}

function persist(sessions: Session[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 90)));
}

// ── Streak ────────────────────────────────────────────────────────────────────
export function getStreak(): number {
  const sessions = loadAll();
  if (!sessions.length) return 0;
  const dates = [
    ...new Set(
      sessions.map((s) =>
        new Date(s.createdAt ?? s.timestamp ?? 0).toDateString(),
      ),
    ),
  ].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < dates.length; i++) {
    const d = new Date(dates[i]);
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.round(
      (today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays === i || (i === 0 && diffDays === 1)) streak++;
    else break;
  }
  return streak;
}

// ── Today summary ─────────────────────────────────────────────────────────────
export interface TodaySummary {
  totalMin: number;
  goodMin: number;
  avgScore: number;
  sessionCount: number;
}

export function getTodaySummary(): TodaySummary {
  const sessions = loadAll();
  const todayStr = new Date().toDateString();
  const todays = sessions.filter(
    (s) =>
      new Date(s.createdAt ?? s.timestamp ?? 0).toDateString() === todayStr,
  );
  if (!todays.length)
    return { totalMin: 0, goodMin: 0, avgScore: 0, sessionCount: 0 };
  const totalMin = todays.reduce((a, s) => a + (s.duration ?? 0), 0);
  const avgScore = Math.round(
    todays.reduce((a, s) => a + s.avg, 0) / todays.length,
  );
  const goodMin = todays.reduce((a, s) => {
    if (s.avg >= 70) return a + (s.duration ?? 0);
    if (s.avg >= 50) return a + Math.round((s.duration ?? 0) * 0.5);
    return a;
  }, 0);
  return { totalMin, goodMin, avgScore, sessionCount: todays.length };
}

// ── Metric trend — last 7 days per metric ────────────────────────────────────
export interface MetricTrend {
  neck: number[];
  shoulder: number[];
  spine: number[];
  headRoll: number[];
  labels: string[];
}

export function getMetricTrend(): MetricTrend {
  const sessions = loadAll();
  const labels: string[] = [];
  const neck: number[] = [];
  const shoulder: number[] = [];
  const spine: number[] = [];
  const headRoll: number[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dateStr = d.toDateString();
    labels.push(d.toLocaleDateString("en", { weekday: "short" }));

    const daySessions = sessions.filter(
      (s) =>
        new Date(s.createdAt ?? s.timestamp ?? 0).toDateString() === dateStr,
    );

    if (!daySessions.length) {
      neck.push(0);
      shoulder.push(0);
      spine.push(0);
      headRoll.push(0);
    } else {
      neck.push(
        Math.round(
          daySessions.reduce((a, s) => a + (s.avgNeck ?? 0), 0) /
            daySessions.length,
        ),
      );
      shoulder.push(
        Math.round(
          daySessions.reduce((a, s) => a + (s.avgShoulder ?? 0), 0) /
            daySessions.length,
        ),
      );
      spine.push(
        Math.round(
          daySessions.reduce((a, s) => a + (s.avgSpine ?? 0), 0) /
            daySessions.length,
        ),
      );
      headRoll.push(
        Math.round(
          daySessions.reduce((a, s) => a + (s.avgHeadRoll ?? 0), 0) /
            daySessions.length,
        ),
      );
    }
  }
  return { neck, shoulder, spine, headRoll, labels };
}

// ── Physio warning — 3+ bad days in a row ────────────────────────────────────
export function needsPhysioWarning(): boolean {
  const sessions = loadAll();
  if (sessions.length < 3) return false;

  const byDay = new Map<string, number[]>();
  sessions.forEach((s) => {
    const key = new Date(s.createdAt ?? s.timestamp ?? 0).toDateString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(s.avg);
  });

  const sortedDays = [...byDay.entries()]
    .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
    .slice(0, 3);

  if (sortedDays.length < 3) return false;

  return sortedDays.every(([, scores]) => {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return avg < 60;
  });
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
export function useSessions() {
  const [data] = useState<Session[]>(() => loadAll());
  return { data, isLoading: false };
}

export function useCreateSession() {
  const mutate = useCallback((partial: Partial<Session>) => {
    const sessions = loadAll();
    const session: Session = {
      id: Date.now().toString(),
      avg: partial.avg ?? 0,
      min: partial.min ?? 0,
      max: partial.max ?? 0,
      duration: partial.duration ?? 0,
      avgNeck: partial.avgNeck ?? 0,
      avgShoulder: partial.avgShoulder ?? 0,
      avgSpine: partial.avgSpine ?? 0,
      avgHeadRoll: partial.avgHeadRoll ?? 0,
      createdAt: new Date(partial.timestamp ?? Date.now()).toISOString(),
      timestamp: partial.timestamp ?? Date.now(),
    };
    sessions.unshift(session);
    persist(sessions);
  }, []);
  return { mutate };
}
