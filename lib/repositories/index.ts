// ---------------------------------------------------------------------------
// Repository Interfaces — Re-exports
// ---------------------------------------------------------------------------

export type { ProfileRepository, Profile } from "./profile-repository";
export type { ClientRepository, ClientRow } from "./client-repository";
export { SessionNotFoundRepoError } from "./session-repository";
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
export type {
  EmbeddingRepository,
  EmbeddingRow,
  SearchOptions,
  SimilarityResult,
} from "./embedding-repository";
export type {
  ConversationRepository,
  ConversationInsert,
  ConversationUpdate,
} from "./conversation-repository";
export type {
  MessageRepository,
  MessageInsert,
  MessageUpdate,
} from "./message-repository";
export type {
  ThemeRepository,
  ThemeInsert,
  ThemeUpdate,
} from "./theme-repository";
export type {
  SignalThemeRepository,
  SignalThemeInsert,
} from "./signal-theme-repository";
export type {
  InsightRepository,
  InsightInsert,
} from "./insight-repository";
export type {
  NotificationRepository,
  NotificationInsert,
  ListForUserOptions,
  ListForUserResult,
  BellNotificationRow,
  ListForBellResult,
  DeleteExpiredOptions,
} from "./notification-repository";
export type {
  ThemeCandidateRepository,
  ThemeCandidatePairsRepository,
  ThemeCandidateInsert,
  ListCandidatesOptions,
} from "./theme-candidate-repository";
export type {
  ThemeDismissalRepository,
  ThemeDismissalInsert,
} from "./theme-dismissal-repository";
export { pairKey } from "./theme-dismissal-repository";
export type {
  ThemeMergeRepository,
  ListMergesOptions,
} from "./theme-merge-repository";
export {
  MergeValidationError,
  MergeNotFoundError,
  MergeRepoError,
} from "./theme-merge-repository";
