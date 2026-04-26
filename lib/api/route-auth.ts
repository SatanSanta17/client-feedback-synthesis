import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import {
  createClient,
  createServiceRoleClient,
  getActiveTeamId,
} from "@/lib/supabase/server";
import { createSessionRepository } from "@/lib/repositories/supabase/supabase-session-repository";
import { createTeamRepository } from "@/lib/repositories/supabase/supabase-team-repository";
import type { SessionRepository } from "@/lib/repositories/session-repository";
import type {
  TeamMemberRow,
  TeamRepository,
  TeamRow,
} from "@/lib/repositories/team-repository";
import { checkSessionAccess } from "@/lib/services/session-service";
import { mapAccessError } from "@/lib/utils/map-access-error";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;
type ServiceSupabaseClient = ReturnType<typeof createServiceRoleClient>;

// ---------------------------------------------------------------------------
// Auth context — produced by requireAuth(); extended by team helpers below.
// ---------------------------------------------------------------------------

export interface AuthContext {
  user: User;
  supabase: ServerSupabaseClient;
  serviceClient: ServiceSupabaseClient;
}

export interface TeamContext extends AuthContext {
  team: TeamRow;
  member: TeamMemberRow;
  teamRepo: TeamRepository;
}

export interface SessionContext extends AuthContext {
  sessionId: string;
  teamId: string | null;
  sessionRepo: SessionRepository;
  teamRepo: TeamRepository;
}

// ---------------------------------------------------------------------------
// requireAuth — resolve current user; return 401 NextResponse on failure.
// ---------------------------------------------------------------------------

export async function requireAuth(): Promise<AuthContext | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  const serviceClient = createServiceRoleClient();
  return { user, supabase, serviceClient };
}

// ---------------------------------------------------------------------------
// Team-context helpers — verify membership/role on a given team.
//
// Roles in this codebase: "admin" | "sales" on team_members; ownership is
// orthogonal and lives on teams.owner_id. Owner is always also an admin
// member (enforced by team-repository.create()), so admin-level routes
// transparently allow owners.
// ---------------------------------------------------------------------------

type RequiredRole = "member" | "admin" | "owner";

async function loadTeamContext(
  teamId: string,
  user: User,
  required: RequiredRole
): Promise<TeamContext | NextResponse> {
  const supabase = await createClient();
  const serviceClient = createServiceRoleClient();
  const teamRepo = createTeamRepository(supabase, serviceClient);

  const team = await teamRepo.getById(teamId);
  if (!team) {
    return NextResponse.json({ message: "Team not found" }, { status: 404 });
  }

  const member = await teamRepo.getMember(teamId, user.id);
  if (!member) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const allowed =
    required === "member"
      ? true
      : required === "admin"
      ? member.role === "admin"
      : team.owner_id === user.id;

  if (!allowed) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  return { user, supabase, serviceClient, team, member, teamRepo };
}

export function requireTeamMember(
  teamId: string,
  user: User
): Promise<TeamContext | NextResponse> {
  return loadTeamContext(teamId, user, "member");
}

export function requireTeamAdmin(
  teamId: string,
  user: User
): Promise<TeamContext | NextResponse> {
  return loadTeamContext(teamId, user, "admin");
}

export function requireTeamOwner(
  teamId: string,
  user: User
): Promise<TeamContext | NextResponse> {
  return loadTeamContext(teamId, user, "owner");
}

// ---------------------------------------------------------------------------
// requireSessionAccess — verify the current user can access a session.
// Wraps the framework-agnostic checkSessionAccess in HTTP framing via
// the existing mapAccessError utility.
// ---------------------------------------------------------------------------

export async function requireSessionAccess(
  sessionId: string,
  user: User
): Promise<SessionContext | NextResponse> {
  const supabase = await createClient();
  const serviceClient = createServiceRoleClient();
  const teamId = await getActiveTeamId();
  const sessionRepo = createSessionRepository(supabase, serviceClient, teamId);
  const teamRepo = createTeamRepository(supabase, serviceClient);

  const result = await checkSessionAccess(
    sessionRepo,
    teamRepo,
    sessionId,
    user.id,
    teamId
  );

  if (!result.allowed) {
    return mapAccessError(result.reason);
  }

  return {
    user,
    supabase,
    serviceClient,
    sessionId,
    teamId,
    sessionRepo,
    teamRepo,
  };
}

// ---------------------------------------------------------------------------
// idempotentNoOp — canonical 409 response for "no-op: state already matches".
// Used when a PATCH/PUT request asks to set a field to its current value.
// ---------------------------------------------------------------------------

export function idempotentNoOp(message: string): NextResponse {
  return NextResponse.json({ message }, { status: 409 });
}
