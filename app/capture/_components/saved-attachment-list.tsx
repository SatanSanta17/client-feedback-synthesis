"use client";

import { useState } from "react";
import {
  FileText,
  Trash2,
  Download,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { formatFileSize } from "@/lib/utils/format-file-size";
import { FILE_ICONS } from "@/lib/constants/file-icons";
import type { SessionAttachment } from "@/lib/services/attachment-service";

interface SavedAttachmentListProps {
  attachments: SessionAttachment[];
  sessionId: string;
  canEdit: boolean;
  hasStructuredNotes: boolean;
  onDeleted: (attachmentId: string) => void;
}

export function SavedAttachmentList({
  attachments,
  sessionId,
  canEdit,
  hasStructuredNotes,
  onDeleted,
}: SavedAttachmentListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-2">
      {attachments.map((attachment) => {
        const Icon = FILE_ICONS[attachment.file_type] ?? FileText;
        const isExpanded = expandedId === attachment.id;
        const isDownloading = downloadingId === attachment.id;
        const isDeleting = deletingId === attachment.id;
        const isConfirming = confirmDeleteId === attachment.id;

        return (
          <div
            key={attachment.id}
            className="rounded-md border border-border bg-muted/30"
          >
            <div className="flex items-center gap-3 px-3 py-2">
              <button
                type="button"
                onClick={() =>
                  setExpandedId(isExpanded ? null : attachment.id)
                }
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={
                  isExpanded ? "Hide parsed content" : "View parsed content"
                }
              >
                {isExpanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>

              <Icon className="size-4 shrink-0 text-muted-foreground" />

              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {attachment.file_name}
              </span>

              <span className="shrink-0 text-xs text-muted-foreground">
                {formatFileSize(attachment.file_size)}
              </span>

              {attachment.source_format !== "generic" && (
                <Badge variant="secondary" className="shrink-0 capitalize">
                  {attachment.source_format}
                </Badge>
              )}

              <button
                type="button"
                onClick={() => handleDownload(attachment)}
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

              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleDeleteClick(attachment.id)}
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

            {isExpanded && (
              <div className="border-t border-border bg-muted/50 px-3 py-2">
                <div className="max-h-48 overflow-y-auto rounded bg-background p-2 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                  {attachment.parsed_content}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
