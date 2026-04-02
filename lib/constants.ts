/**
 * The email domain allowed to sign in.
 * Read from ALLOWED_EMAIL_DOMAIN env var. Must be set in production.
 */
export const ALLOWED_EMAIL_DOMAIN =
  process.env.ALLOWED_EMAIL_DOMAIN ?? "gmail.com";
