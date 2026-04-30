/**
 * Pluralizes an English word based on count: returns the word as-is when
 * count is 1, with an "s" suffix otherwise. Pure helper — no locale aware-
 * ness, no irregular plurals; if the codebase ever needs them, swap to
 * `Intl.PluralRules` here without touching call sites.
 */
export function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}
