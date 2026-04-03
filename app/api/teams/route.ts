import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createTeam } from "@/lib/services/team-service";

const createTeamSchema = z.object({
  name: z
    .string()
    .min(1, "Team name is required")
    .max(100, "Team name must be 100 characters or fewer"),
});

export async function POST(request: NextRequest) {
  console.log("[api/teams] POST — creating team");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("can_create_team")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    console.error("[api/teams] POST — profile fetch failed:", profileError?.message);
    return NextResponse.json(
      { message: "Failed to verify permissions" },
      { status: 500 }
    );
  }

  if (!profile.can_create_team) {
    return NextResponse.json(
      { message: "Team creation is not enabled for your account" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = createTeamSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(", ");
    return NextResponse.json({ message }, { status: 400 });
  }

  try {
    const team = await createTeam(parsed.data.name, user.id);
    console.log(`[api/teams] POST — created team: ${team.id}`);
    return NextResponse.json({ team: { id: team.id, name: team.name } }, { status: 201 });
  } catch (err) {
    console.error(
      "[api/teams] POST — error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to create team" },
      { status: 500 }
    );
  }
}
