"use client";

import { useRef, useState, useCallback } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_ATTACHMENTS,
  ACCEPTED_EXTENSIONS,
} from "@/lib/constants";
import { formatFileSize } from "@/lib/utils/format-file-size";

export interface ParsedAttachment {
  file: File;
  parsed_content: string;
  file_name: string;
  file_type: string;
  file_size: number;
  source_format: string;
}

interface FileUploadZoneProps {
  onFileParsed: (result: ParsedAttachment) => void;
  disabled?: boolean;
  currentCount: number;
}

function hasValidExtension(fileName: string): boolean {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return ACCEPTED_EXTENSIONS.includes(ext);
}

export function FileUploadZone({
  onFileParsed,
  disabled = false,
  currentCount,
}: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [parsing, setParsing] = useState(0);

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const remaining = MAX_ATTACHMENTS - currentCount;

      if (remaining <= 0) {
        toast.error(`Maximum ${MAX_ATTACHMENTS} attachments per session.`);
        return;
      }

      const toProcess = fileArray.slice(0, remaining);
      if (toProcess.length < fileArray.length) {
        toast.warning(
          `Only ${remaining} more file${remaining === 1 ? "" : "s"} allowed. ${fileArray.length - toProcess.length} skipped.`
        );
      }

      for (const file of toProcess) {
        if (!hasValidExtension(file.name)) {
          toast.error(
            `"${file.name}" is not a supported format. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}`
          );
          continue;
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
          toast.error(
            `"${file.name}" exceeds the ${formatFileSize(MAX_FILE_SIZE_BYTES)} limit (${formatFileSize(file.size)}).`
          );
          continue;
        }

        setParsing((p) => p + 1);

        try {
          const formData = new FormData();
          formData.append("file", file);

          const response = await fetch("/api/files/parse", {
            method: "POST",
            body: formData,
          });

          if (!response.ok) {
            const data = await response.json().catch(() => null);
            toast.error(data?.message ?? `Failed to parse "${file.name}"`);
            continue;
          }

          const result = await response.json();
          onFileParsed({
            file,
            parsed_content: result.parsed_content,
            file_name: result.file_name,
            file_type: result.file_type,
            file_size: result.file_size,
            source_format: result.source_format,
          });
        } catch {
          toast.error(`Failed to parse "${file.name}" — please try again.`);
        } finally {
          setParsing((p) => p - 1);
        }
      }
    },
    [currentCount, onFileParsed]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (disabled) return;
      processFiles(e.dataTransfer.files);
    },
    [disabled, processFiles]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFiles(e.target.files);
      }
      if (inputRef.current) inputRef.current.value = "";
    },
    [processFiles]
  );

  const isDisabled = disabled || parsing > 0;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDisabled) setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => {
        if (!isDisabled) inputRef.current?.click();
      }}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
        isDragOver
          ? "border-primary bg-primary/5"
          : "border-border bg-muted/30",
        isDisabled ? "pointer-events-none opacity-50" : "cursor-pointer hover:border-primary/50 hover:bg-primary/5"
      )}
    >
      <Upload className="size-6 text-muted-foreground" />

      {parsing > 0 ? (
        <p className="text-sm text-muted-foreground">
          Parsing {parsing} file{parsing > 1 ? "s" : ""}…
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Drag and drop files or{" "}
            <span className="font-medium text-primary underline-offset-2 hover:underline">
              browse
            </span>
          </p>
          <p className="text-xs text-muted-foreground/70">
            TXT, PDF, CSV, DOCX, JSON — max 10 MB
          </p>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(",")}
        multiple
        onChange={handleFileChange}
        className="hidden"
        disabled={isDisabled}
      />
    </div>
  );
}
