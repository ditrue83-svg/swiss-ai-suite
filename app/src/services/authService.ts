// ============================================================================
// authService — unico punto di contatto con Supabase Auth.
// Nessun componente chiama supabase.auth direttamente.
// ============================================================================
import type { Session, User, AuthChangeEvent } from '@supabase/supabase-js';
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { publicUrl } from '@/lib/env';
import type { UserProfile } from '@/types/models';
import { translate as tr } from '@/i18n';

export interface SignUpInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}
export interface SignInInput {
  email: string;
  password: string;
}
export interface SignUpResult {
  user: User | null;
  session: Session | null;
  needsEmailConfirmation: boolean;
}

export const authService = {
  async getSession(): Promise<Session | null> {
    const { data, error } = await requireSupabase().auth.getSession();
    if (error) throw new AppError(toUserMessage(error), error);
    return data.session;
  },

  onAuthStateChange(cb: (event: AuthChangeEvent, session: Session | null) => void) {
    return requireSupabase().auth.onAuthStateChange(cb);
  },

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    const { data, error } = await requireSupabase().auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        data: { first_name: input.firstName.trim(), last_name: input.lastName.trim() },
        // URL canonico se configurato (VITE_PUBLIC_SITE_URL), altrimenti l'origine
        // corrente: dev'essere fra i Redirect URLs del progetto, o il link non funziona.
        emailRedirectTo: publicUrl('/login'),
      },
    });
    if (error) throw new AppError(toUserMessage(error), error);
    return {
      user: data.user,
      session: data.session,
      // Se non torna una sessione, il progetto richiede conferma email.
      needsEmailConfirmation: !data.session,
    };
  },

  async signIn(input: SignInInput): Promise<Session> {
    const { data, error } = await requireSupabase().auth.signInWithPassword({
      email: input.email.trim(),
      password: input.password,
    });
    if (error) throw new AppError(toUserMessage(error), error);
    if (!data.session) throw new AppError(tr('errors.signInFailed'));
    return data.session;
  },

  async signOut(): Promise<void> {
    const { error } = await requireSupabase().auth.signOut();
    if (error) throw new AppError(toUserMessage(error), error);
  },

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await requireSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: publicUrl('/reset-password'),
    });
    if (error) throw new AppError(toUserMessage(error), error);
  },

  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await requireSupabase().auth.updateUser({ password: newPassword });
    if (error) throw new AppError(toUserMessage(error), error);
  },

  async getProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await requireSupabase()
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new AppError(toUserMessage(error), error);
    if (!data) return null;
    return { id: data.id, firstName: data.first_name, lastName: data.last_name, email: data.email };
  },

  async updateProfile(userId: string, patch: { firstName?: string; lastName?: string }): Promise<void> {
    const { error } = await requireSupabase()
      .from('profiles')
      .update({ first_name: patch.firstName, last_name: patch.lastName })
      .eq('id', userId);
    if (error) throw new AppError(toUserMessage(error), error);
  },
};
