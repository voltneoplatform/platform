'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import type { AuthSession, Permission, StaffProfile } from '@voltneo/shared';
import { ApiClient } from './api';

/** Matches the server's idle limit (SESSION_IDLE_TIMEOUT_MINUTES). */
const IDLE_LIMIT_MS = 30 * 60_000;

interface SessionState {
  status: 'loading' | 'signed-in' | 'signed-out';
  staff: StaffProfile | null;
  permissions: Permission[];
  api: ApiClient;
  can: (p: Permission) => boolean;
  signIn: (session: AuthSession) => void;
  signOut: (reason?: string) => Promise<void>;
  notice: string | null;
  clearNotice: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = useCallback((s: AuthSession | null) => {
    setStaff(s?.staff ?? null);
    setPermissions(s?.permissions ?? []);
    setStatus(s ? 'signed-in' : 'signed-out');
  }, []);

  const apiRef = useRef<ApiClient | null>(null);
  if (!apiRef.current) {
    apiRef.current = new ApiClient({
      onSession: (s) => apply(s),
      onSessionEnded: () => {
        apply(null);
        setNotice('Your session has ended. Please log in again.');
      },
    });
  }
  const api = apiRef.current;

  useEffect(() => {
    void api.refresh().then((s) => apply(s));
  }, [api, apply]);

  const signIn = useCallback(
    (s: AuthSession) => {
      api.setAccessToken(s.accessToken);
      setNotice(null);
      apply(s);
    },
    [api, apply],
  );

  const signOut = useCallback(
    async (reason?: string) => {
      try {
        await api.post('/v1/auth/logout');
      } catch {
        // The session may already be gone; signing out locally is enough.
      }
      api.setAccessToken(null);
      apply(null);
      setNotice(reason ?? null);
      router.replace('/login');
    },
    [api, apply, router],
  );

  // Sign out after 30 minutes without mouse, keyboard or touch activity.
  useEffect(() => {
    if (status !== 'signed-in') return;
    let timer = setTimeout(
      () => void signOut('You were signed out after 30 minutes without activity.'),
      IDLE_LIMIT_MS,
    );
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => void signOut('You were signed out after 30 minutes without activity.'),
        IDLE_LIMIT_MS,
      );
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [status, signOut]);

  const value = useMemo<SessionState>(
    () => ({
      status,
      staff,
      permissions,
      api,
      can: (p) => permissions.includes(p),
      signIn,
      signOut,
      notice,
      clearNotice: () => setNotice(null),
    }),
    [status, staff, permissions, api, signIn, signOut, notice],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
