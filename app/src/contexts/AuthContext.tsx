// ============================================================================
// AuthContext — sessione utente e profilo. La sessione persiste al refresh
// (Supabase salva il token) e reagisce a scadenza/logout (TEST 7).
// ============================================================================
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { authService, type SignInInput, type SignUpInput, type SignUpResult } from '@/services/authService';
import { isSupabaseConfigured } from '@/lib/env';
import { verifySupabaseConfig, type ConfigStatus } from '@/lib/configCheck';
import type { UserProfile } from '@/types/models';

interface AuthContextValue {
  /** true se le variabili ci sono. NON garantisce che siano valide: vedi configStatus. */
  configured: boolean;
  /** esito della verifica presso il server: distingue «assente» da «presente ma rifiutata». */
  configStatus: ConfigStatus;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  signIn: (input: SignInInput) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [configStatus, setConfigStatus] = useState<ConfigStatus>(
    isSupabaseConfigured ? 'checking' : 'missing',
  );
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const loadedFor = useRef<string | null>(null);

  const user = session?.user ?? null;

  async function loadProfile(userId: string) {
    try {
      const p = await authService.getProfile(userId);
      setProfile(p);
      loadedFor.current = userId;
    } catch {
      setProfile(null);
    }
  }

  // Verifica che la chiave sia ACCETTATA, non solo presente. Gira in parallelo
  // al ripristino della sessione e non ritarda l'avvio: finché è 'checking'
  // l'app si comporta normalmente, e cambia schermata solo se il server rifiuta.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    verifySupabaseConfig()
      .then((s) => { if (active) setConfigStatus(s); })
      .catch(() => { if (active) setConfigStatus('unreachable'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    let active = true;

    authService
      .getSession()
      .then((s) => {
        if (!active) return;
        setSession(s);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data: sub } = authService.onAuthStateChange((_event, s) => {
      if (!active) return;
      setSession(s);
      if (!s) {
        setProfile(null);
        loadedFor.current = null;
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Carica il profilo quando cambia l'utente autenticato.
  useEffect(() => {
    if (user && loadedFor.current !== user.id) {
      void loadProfile(user.id);
    }
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isSupabaseConfigured,
      configStatus,
      loading,
      session,
      user,
      profile,
      signIn: async (input) => {
        await authService.signIn(input);
      },
      signUp: (input) => authService.signUp(input),
      signOut: async () => {
        await authService.signOut();
      },
      requestPasswordReset: (email) => authService.requestPasswordReset(email),
      updatePassword: (password) => authService.updatePassword(password),
      refreshProfile: async () => {
        if (user) await loadProfile(user.id);
      },
    }),
    [loading, session, user, profile, configStatus],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve essere usato dentro <AuthProvider>');
  return ctx;
}
