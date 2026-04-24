export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// Route constants — change these to redirect users to a different page app-wide
export const DEFAULT_AUTH_ROUTE = "/dashboard";
export const ONBOARDING_ROUTE = "/capture";

export const MAX_COMBINED_CHARS = 50_000;

export const MAX_ATTACHMENTS = 5;

export const ACCEPTED_FILE_TYPES: Record<string, string[]> = {
  "text/plain": [".txt"],
  "application/pdf": [".pdf"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/json": [".json"],
};

export const ACCEPTED_EXTENSIONS = [".txt", ".pdf", ".csv", ".docx", ".json"];
