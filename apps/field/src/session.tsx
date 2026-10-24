import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { hasPermission, type Permission, type StaffProfile } from '@voltneo/shared';
import { FieldApi } from './api';
import { LANGS, translate, type Lang, type MessageKey, type Params } from './i18n';
import { LABELS, type Labels } from './i18n/labels';
import { prefs, refreshTokenStore } from './storage';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

interface SessionState {
  status: 'loading' | 'signed-out' | 'signed-in';
  staff: StaffProfile | null;
  can: (p: Permission) => boolean;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MessageKey, params?: Params) => string;
  labels: Labels;
  api: FieldApi;
  signIn: (identifier: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Set when a head-office role tries to use the app. */
  wrongRole: boolean;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [lang, setLangState] = useState<Lang>('BN');
  const [wrongRole, setWrongRole] = useState(false);

  const api = useMemo(
    () =>
      new FieldApi({
        baseUrl: API_URL,
        store: refreshTokenStore,
        onSessionEnded: () => {
          setStaff(null);
          setStatus('signed-out');
        },
      }),
    [],
  );

  const accept = useCallback(
    async (profile: StaffProfile | null) => {
      if (profile && !hasPermission(profile.role, 'field_app.access')) {
        await api.signOut();
        setWrongRole(true);
        setStaff(null);
        setStatus('signed-out');
        return;
      }
      setWrongRole(false);
      setStaff(profile);
      setStatus(profile ? 'signed-in' : 'signed-out');
    },
    [api],
  );

  useEffect(() => {
    void (async () => {
      const saved = await prefs.getLang();
      if (saved && (LANGS as readonly string[]).includes(saved)) setLangState(saved as Lang);
      try {
        const s = await api.restore();
        await accept(s?.staff ?? null);
      } catch {
        // No signal at start-up: ask to sign in again rather than hang.
        setStatus('signed-out');
      }
    })();
  }, [api, accept]);

  const value = useMemo<SessionState>(
    () => ({
      status,
      staff,
      can: (p) => (staff ? hasPermission(staff.role, p) : false),
      lang,
      setLang: (l) => {
        setLangState(l);
        void prefs.setLang(l);
      },
      t: (key, params) => translate(lang, key, params),
      labels: LABELS[lang],
      api,
      wrongRole,
      signIn: async (identifier, code) => {
        const s = await api.verify(identifier, code);
        await prefs.setIdentifier(identifier);
        await accept(s.staff);
      },
      signOut: async () => {
        await api.signOut();
        setStaff(null);
        setStatus('signed-out');
      },
    }),
    [status, staff, lang, api, wrongRole, accept],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
