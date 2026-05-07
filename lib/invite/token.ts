const INVITE_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export function parseInviteToken(
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  return INVITE_TOKEN_PATTERN.test(raw) ? raw.toLowerCase() : null;
}
