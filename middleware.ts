import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Keep in sync with DEFAULT_AUTH_ROUTE in lib/constants.ts
// Inlined here to avoid Edge Runtime import issues with path aliases
const DEFAULT_AUTH_ROUTE = "/dashboard";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session so it doesn't expire while the user is active.
  // IMPORTANT: getUser() sends a request to Supabase Auth to revalidate the
  // session. Do NOT replace with getSession() — that only reads the JWT
  // without revalidating, which could allow expired sessions through.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isPublicRoute =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/invite");

  if (!user && !isPublicRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user visiting auth pages → send them to the app
  if (
    user &&
    (pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/forgot-password")
  ) {
    const authUrl = request.nextUrl.clone();
    authUrl.pathname = DEFAULT_AUTH_ROUTE;
    return NextResponse.redirect(authUrl);
  }

  // Validate active_team_id cookie — clear if user was removed from the team
  if (user) {
    const activeTeamId = request.cookies.get("active_team_id")?.value;

    if (activeTeamId) {
      const { data: membership } = await supabase
        .from("team_members")
        .select("id")
        .eq("team_id", activeTeamId)
        .eq("user_id", user.id)
        .is("removed_at", null)
        .maybeSingle();

      if (!membership) {
        supabaseResponse.cookies.set("active_team_id", "", {
          path: "/",
          maxAge: 0,
        });
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico, sitemap.xml, robots.txt
     */
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt).*)",
  ],
};
