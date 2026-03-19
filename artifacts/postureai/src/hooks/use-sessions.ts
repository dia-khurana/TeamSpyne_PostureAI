import { useState, useCallback } from "react";

export interface Session {
  id: string;
  avg: number;
  min: number;
  max: number;
  duration: number;
  createdAt: string;
  timestamp?: number;
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 60)));
}

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
      createdAt: new Date(partial.timestamp ?? Date.now()).toISOString(),
      timestamp: partial.timestamp ?? Date.now(),
    };
    sessions.unshift(session);
    persist(sessions);
  }, []);
  return { mutate };
}
