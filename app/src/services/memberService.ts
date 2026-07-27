// ============================================================================
// memberService — chi lavora in questa azienda.
//
// Esiste per una ragione precisa: `profiles` è leggibile SOLO dal proprietario
// (policy `profiles_select_own`, migrazione 0001), quindi una query diretta non
// restituirebbe il nome di un collega e l'interfaccia mostrerebbe
// identificativi al posto delle persone. La rubrica passa dalla funzione
// `company_member_directory`, che espone il minimo indispensabile — chi sei e
// che ruolo hai — e solo a chi è membro della stessa azienda.
//
// Un solo posto da cui prendere i membri: le schermate non ripetono la query,
// e il giorno che cambia il modo di risolvere i nomi cambia qui.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import type { AssignableMember, MemberRole } from '@/types/models';

interface DirectoryRow {
  user_id: string;
  display_name: string | null;
  role: MemberRole;
}

export const memberService = {
  /**
   * I membri assegnabili dell'azienda attiva.
   *
   * `display_name` può essere nullo se la persona non ha ancora completato il
   * profilo: in quel caso il nome NON viene inventato — decide la schermata
   * come chiamarla, con una formula tradotta.
   */
  async listAssignable(companyId: string): Promise<AssignableMember[]> {
    const { data, error } = await requireSupabase()
      .rpc('company_member_directory', { p_company_id: companyId });
    if (error) throw new AppError(toUserMessage(error), error);
    return ((data ?? []) as DirectoryRow[]).map((r) => ({
      userId: r.user_id,
      name: r.display_name ?? '',
      role: r.role,
    }));
  },
};
