/**
 * The email domain allowed to sign in.
 * Read from ALLOWED_EMAIL_DOMAIN env var, falls back to "inmobi.com".
 */
export const ALLOWED_EMAIL_DOMAIN =
  process.env.ALLOWED_EMAIL_DOMAIN ?? "inmobi.com";
