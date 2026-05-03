import { toast } from "sonner";

// Discriminated union — both kinds POST to the same route but ship different
// FormData fields. The route branches on `source_format` to choose the path.
export type PendingAttachmentUpload =
  | {
      kind: "parsed";
      file: File;
      file_name: string;
      parsed_content: string;
      source_format: string;
    }
  | {
      kind: "video_transcript";
      file_name: string;
      file_type: string;
      file_size: number;
      duration_seconds: number;
      parsed_content: string;
    };

export async function uploadAttachmentsToSession(
  sessionId: string,
  attachments: PendingAttachmentUpload[]
): Promise<void> {
  let failCount = 0;

  for (const attachment of attachments) {
    try {
      const formData = new FormData();

      if (attachment.kind === "parsed") {
        formData.append("file", attachment.file);
        formData.append("parsed_content", attachment.parsed_content);
        formData.append("source_format", attachment.source_format);
      } else {
        formData.append("source_format", "video_transcript");
        formData.append("parsed_content", attachment.parsed_content);
        formData.append("video_file_name", attachment.file_name);
        formData.append("video_file_type", attachment.file_type);
        formData.append("video_file_size", String(attachment.file_size));
        formData.append("duration_seconds", String(attachment.duration_seconds));
      }

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
