import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    console.error("Auth callback: missing code parameter");
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error("Auth callback: code exchange failed", exchangeError.message);
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  // Verify the user's email domain
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) {
    console.error(
      "Auth callback: could not retrieve user",
      userError?.message
    );
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=no_email`);
  }

  const emailDomain = user.email.split("@")[1];

  if (emailDomain !== ALLOWED_EMAIL_DOMAIN) {
    console.warn(
      `Auth callback: domain mismatch — ${emailDomain} is not ${ALLOWED_EMAIL_DOMAIN}`
    );
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain_restricted`);
  }

  // Domain matches — redirect to the app
  return NextResponse.redirect(`${origin}/capture`);
}
