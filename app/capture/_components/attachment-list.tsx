"use client";

import { useState } from "react";
import {
  FileText,
  FileSpreadsheet,
  FileJson2,
  FileType2,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ParsedAttachment } from "./file-upload-zone";

interface AttachmentListProps {
  attachments: ParsedAttachment[];
  onRemove: (index: number) => void;
}

const FILE_ICONS: Record<string, React.ElementType> = {
  "text/plain": FileText,
  "text/csv": FileSpreadsheet,
  "application/pdf": FileType2,
  "application/json": FileJson2,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    FileText,
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentList({ attachments, onRemove }: AttachmentListProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {attachments.map((attachment, index) => {
        const Icon = FILE_ICONS[attachment.file_type] ?? FileText;
        const isExpanded = expandedIndex === index;

        return (
          <div
            key={`${attachment.file_name}-${index}`}
            className="rounded-md border border-border bg-muted/30"
          >
            <div className="flex items-center gap-3 px-3 py-2">
              <button
                type="button"
                onClick={() =>
                  setExpandedIndex(isExpanded ? null : index)
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
                onClick={() => onRemove(index)}
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Remove ${attachment.file_name}`}
              >
                <X className="size-3.5" />
              </button>
            </div>

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
