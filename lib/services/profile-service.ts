import type { ProfileRepository, Profile } from "@/lib/repositories/profile-repository";

export type { Profile };

/**
 * Fetches the profile for the given user ID.
 * Returns null if not found.
 */
export async function getProfileByUserId(
  repo: ProfileRepository,
  userId: string
): Promise<Profile | null> {
  console.log("[profile-service] getProfileByUserId — userId:", userId);

  const profile = await repo.getByUserId(userId);

  if (!profile) {
    console.warn("[profile-service] getProfileByUserId — not found for userId:", userId);
    return null;
  }

  return profile;
}
