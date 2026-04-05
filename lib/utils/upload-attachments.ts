import { toast } from "sonner";

interface PendingAttachment {
  file: File;
  file_name: string;
  parsed_content: string;
  source_format: string;
}

export async function uploadAttachmentsToSession(
  sessionId: string,
  attachments: PendingAttachment[]
): Promise<void> {
  let failCount = 0;

  for (const attachment of attachments) {
    try {
      const formData = new FormData();
      formData.append("file", attachment.file);
      formData.append("parsed_content", attachment.parsed_content);
      formData.append("source_format", attachment.source_format);

      const res = await fetch(`/api/sessions/${sessionId}/attachments`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        failCount++;
        console.error(
          `[uploadAttachmentsToSession] upload failed for "${attachment.file_name}":`,
          await res.text().catch(() => "unknown error")
        );
      }
    } catch (err) {
      failCount++;
      console.error(
        `[uploadAttachmentsToSession] upload error for "${attachment.file_name}":`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (failCount > 0) {
    toast.warning(
      `${failCount} attachment${failCount > 1 ? "s" : ""} failed to upload. The session was saved.`
    );
  }
}
