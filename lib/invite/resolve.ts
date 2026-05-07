import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";
import { getInvitationByToken } from "@/lib/services/invitation-service";
import { parseInviteToken } from "@/lib/invite/token";

export interface ResolvedInvitedEmail {
  token: string;
  invitedEmail: string;
}

/**
 * Resolves a `?invite=` query parameter into the locked email + canonical
 * token, or null if the param is missing / malformed / no longer valid.
 *
 * Used by `/login` and `/signup` to populate invite-mode props on the form.
 */
export async function resolveInvitedEmailFromParam(
  rawInvite: string | null | undefined
): Promise<ResolvedInvitedEmail | null> {
  const token = parseInviteToken(rawInvite);
  if (!token) return null;

  const supabase = await createClient();
  const serviceClient = createServiceRoleClient();
  const repo = createInvitationRepository(supabase, serviceClient);
  const result = await getInvitationByToken(repo, token);

  if (result?.status !== "valid") return null;

  return { token, invitedEmail: result.invitation.email };
}
