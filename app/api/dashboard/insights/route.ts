import { NextResponse } from "next/server";

import {
  createClient,
  createServiceRoleClient,
  getActiveTeamId,
} from "@/lib/supabase/server";
import { createInsightRepository } from "@/lib/repositories/supabase/supabase-insight-repository";
import { generateHeadlineInsights } from "@/lib/services/insight-service";

const LOG_PREFIX = "[api/dashboard/insights]";

// ---------------------------------------------------------------------------
// POST /api/dashboard/insights — Generate new headline insights
// ---------------------------------------------------------------------------

export async function POST() {
  console.log(`${LOG_PREFIX} POST — generating headline insights`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn(`${LOG_PREFIX} POST — unauthenticated`);
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  const teamId = await getActiveTeamId();
  const serviceClient = createServiceRoleClient();
  const insightRepo = createInsightRepository(serviceClient);

  try {
    const insights = await generateHeadlineInsights({
      teamId,
      userId: user.id,
      insightRepo,
      supabase: serviceClient,
    });

    console.log(
      `${LOG_PREFIX} POST — generated ${insights.length} insights`
    );

    return NextResponse.json({ insights });
  } catch (err) {
    console.error(
      `${LOG_PREFIX} POST — generation failed:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to generate headline insights" },
      { status: 500 }
    );
  }
}
