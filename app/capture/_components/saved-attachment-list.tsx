"use client";

import { useState } from "react";
import {
  FileText,
  Trash2,
  Download,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { formatFileSize } from "@/lib/utils/format-file-size";
import { FILE_ICONS } from "@/lib/constants/file-icons";
import type { SessionAttachment } from "@/lib/services/attachment-service";
import { TranscriptEditor } from "./transcript-editor";
import { EditedBadge } from "./edited-badge";

interface SavedAttachmentListProps {
  attachments: SessionAttachment[];
  sessionId: string;
  canEdit: boolean;
  hasStructuredNotes: boolean;
  onDeleted: (attachmentId: string) => void;
  // PRD-032 Part 3 — fires after a successful PATCH to /api/sessions/[id]/attachments/[attachmentId].
  // Parent updates its `savedAttachments` state with the row from the response.
  onEdited: (attachment: SessionAttachment) => void;
}

export function SavedAttachmentList({
  attachments,
  sessionId,
  canEdit,
  hasStructuredNotes,
  onDeleted,
  onEdited,
}: SavedAttachmentListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  const handleDownload = async (attachment: SessionAttachment) => {
    setDownloadingId(attachment.id);

    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/attachments/${attachment.id}/download`
      );

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.message ?? "Failed to download file");
        return;
      }

      const { url } = await res.json();
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.file_name;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      toast.error("Failed to download file — please try again");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (attachmentId: string) => {
    setDeletingId(attachmentId);
    setConfirmDeleteId(null);

    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/attachments/${attachmentId}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.message ?? "Failed to delete attachment");
        return;
      }

      toast.success("Attachment deleted");
      onDeleted(attachmentId);
    } catch {
      toast.error("Failed to delete attachment — please try again");
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteClick = (attachmentId: string) => {
    if (hasStructuredNotes) {
      setConfirmDeleteId(attachmentId);
    } else {
      handleDelete(attachmentId);
    }
  };

  // PRD-032 Part 3 — PATCH the transcript edit. The route validates non-empty
  // content + combined-char cap server-side; client surfaces the message
  // verbatim on failure. On success the parent merges the updated row into
  // savedAttachments via onEdited.
  const handleSaveEdit = async (
    attachmentId: string,
    newContent: string
  ): Promise<void> => {
    setSavingEditId(attachmentId);

    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/attachments/${attachmentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parsed_content: newContent }),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.message ?? "Failed to save transcript");
        return;
      }

      const { attachment: updated } = await res.json();
      onEdited(updated);
      setEditingId(null);
      toast.success("Transcript saved");
    } catch {
      toast.error("Failed to save transcript — please try again");
    } finally {
      setSavingEditId(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {attachments.map((attachment) => {
        const Icon = FILE_ICONS[attachment.file_type] ?? FileText;
        const isExpanded = expandedId === attachment.id;
        const isDownloading = downloadingId === attachment.id;
        const isDeleting = deletingId === attachment.id;
        const isConfirming = confirmDeleteId === attachment.id;
        const isEditing = editingId === attachment.id;
        const isSavingEdit = savingEditId === attachment.id;
        const isTranscript = attachment.source_format === "video_transcript";
        // Hide the "video_transcript" badge — the sub-label + EditedBadge
        // already communicate it; "video_transcript" as raw text is noisy.
        const showFormatBadge =
          attachment.source_format !== "generic" && !isTranscript;
        const showEditedBadge = isTranscript && attachment.last_edited_at !== null;

        return (
          <div
            key={attachment.id}
            className="rounded-md border border-border bg-muted/30"
          >
            <div
              className={
                isEditing
                  ? "flex items-center gap-3 px-3 py-2"
                  : "flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50"
              }
              onClick={
                isEditing
                  ? undefined
                  : () => setExpandedId(isExpanded ? null : attachment.id)
              }
              role={isEditing ? undefined : "button"}
              aria-expanded={isEditing ? undefined : isExpanded}
              aria-label={
                isEditing
                  ? undefined
                  : isExpanded
                    ? "Hide parsed content"
                    : "View parsed content"
              }
            >
              <span className="shrink-0 text-muted-foreground">
                {isExpanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </span>

              <Icon className="size-4 shrink-0 text-muted-foreground" />

              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-foreground">
                  {attachment.file_name}
                </span>
                {/* PRD-032 P3.R1 — sub-label only on transcript rows */}
                {isTranscript && (
                  <span className="text-xs text-muted-foreground/80">
                    Transcript only — original video not stored
                  </span>
                )}
              </div>

              <span className="shrink-0 text-xs text-muted-foreground">
                {formatFileSize(attachment.file_size)}
              </span>

              {showFormatBadge && (
                <Badge variant="secondary" className="shrink-0 capitalize">
                  {attachment.source_format}
                </Badge>
              )}

              {showEditedBadge && (
                <EditedBadge timestamp={attachment.last_edited_at} />
              )}

              {/* PRD-032 P3.R7 — Edit button is exclusive to video transcripts */}
              {isTranscript && canEdit && !isEditing && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(attachment.id);
                    setExpandedId(null);
                  }}
                  disabled={isSavingEdit || isDeleting}
                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  aria-label={`Edit ${attachment.file_name}`}
                >
                  <Pencil className="size-3.5" />
                </button>
              )}

              {/* PRD-032 Part 2 — video transcripts have no original blob */}
              {!isTranscript && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(attachment);
                  }}
                  disabled={isDownloading}
                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  aria-label={`Download ${attachment.file_name}`}
                >
                  {isDownloading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                </button>
              )}

              {canEdit && !isEditing && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteClick(attachment.id);
                  }}
                  disabled={isDeleting}
                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  aria-label={`Delete ${attachment.file_name}`}
                >
                  {isDeleting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </button>
              )}
            </div>

            {isConfirming && (
              <div className="flex items-center gap-2 border-t border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <span className="flex-1">
                  Signals have already been extracted. Deleting this attachment
                  won&apos;t affect them. Continue?
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(attachment.id)}
                  className="rounded px-2 py-1 font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded px-2 py-1 font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            )}

            {isEditing ? (
              <TranscriptEditor
                initialContent={attachment.parsed_content}
                isSaving={isSavingEdit}
                onSave={(newContent) => handleSaveEdit(attachment.id, newContent)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              isExpanded && (
                <div className="border-t border-border bg-muted/50 px-3 py-2">
                  <div className="max-h-48 overflow-y-auto rounded bg-background p-2 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                    {attachment.parsed_content}
                  </div>
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
