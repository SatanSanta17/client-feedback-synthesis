interface AttachmentLike {
  file_name: string;
  source_format: string;
  parsed_content: string;
}

export function composeAIInput(
  rawNotes: string,
  attachments: AttachmentLike[]
): string {
  const parts: string[] = [];

  if (rawNotes.trim()) {
    parts.push(rawNotes.trim());
  }

  for (const a of attachments) {
    const label =
      a.source_format !== "generic"
        ? `[Attached file: ${a.file_name} (${a.source_format} format)]`
        : `[Attached file: ${a.file_name}]`;
    parts.push(`${label}\n${a.parsed_content}`);
  }

  return parts.join("\n\n---\n\n");
}
