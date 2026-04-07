// ---------------------------------------------------------------------------
// Profile Repository Interface
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  email: string;
  is_admin: boolean;
  can_create_team: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfileRepository {
  getByUserId(userId: string): Promise<Profile | null>;
}
