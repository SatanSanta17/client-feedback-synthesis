export function appendInviteParam(
  path: string,
  token: string | null
): string {
  if (!token) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}invite=${token}`;
}
