// ---------------------------------------------------------------------------
// Repository Interfaces — Re-exports
// ---------------------------------------------------------------------------

export type { ProfileRepository, Profile } from "./profile-repository";
export type { ClientRepository, ClientRow } from "./client-repository";
export type {
  SessionRepository,
  SessionListFilters,
  SessionRow,
  SessionInsert,
  SessionUpdate,
  SessionDeleteResult,
  SessionAccessRow,
} from "./session-repository";
export type {
  TeamRepository,
  TeamRow,
  TeamMemberRow,
  TeamMemberWithProfileRow,
  TeamWithRoleRow,
} from "./team-repository";
export type {
  MasterSignalRepository,
  MasterSignalRow,
} from "./master-signal-repository";
export type {
  InvitationRepository,
  InvitationRow,
  InvitationWithTeamRow,
} from "./invitation-repository";
export type {
  PromptRepository,
  PromptKey,
  PromptVersionRow,
} from "./prompt-repository";
export type {
  AttachmentRepository,
  AttachmentRow,
  AttachmentInsert,
} from "./attachment-repository";
