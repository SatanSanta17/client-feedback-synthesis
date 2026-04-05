import pdfParse from "pdf-parse/lib/pdf-parse";
import mammoth from "mammoth";
import Papa from "papaparse";

export type SourceFormat = "whatsapp" | "slack" | "generic";

export interface ParsedFileResult {
  parsed_content: string;
  source_format: SourceFormat;
}

export class FileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileParseError";
  }
}

/**
 * Parse a file buffer into plain text with optional chat format detection.
 * Throws FileParseError on failure or empty content.
 */
export async function parseFile(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<ParsedFileResult> {
  const ext = getExtension(fileName);
  let rawContent: string;

  try {
    switch (ext) {
      case ".txt":
        rawContent = parseTxt(buffer);
        break;
      case ".pdf":
        rawContent = await parsePdf(buffer);
        break;
      case ".csv":
        rawContent = parseCsv(buffer);
        break;
      case ".docx":
        rawContent = await parseDocx(buffer);
        break;
      case ".json":
        return parseJsonWithDetection(buffer);
      default:
        throw new FileParseError(`Unsupported file extension: ${ext}`);
    }
  } catch (err) {
    if (err instanceof FileParseError) throw err;
    throw new FileParseError(
      `Could not parse ${fileName}: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  if (!rawContent.trim()) {
    throw new FileParseError(
      "No content could be extracted from this file."
    );
  }

  return detectAndRestructure(rawContent, mimeType);
}

// ---------------------------------------------------------------------------
// Format-specific parsers
// ---------------------------------------------------------------------------

function parseTxt(buffer: Buffer): string {
  return buffer.toString("utf-8");
}

async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch {
    throw new FileParseError(
      "Could not extract text from this PDF — it may be scanned or encrypted."
    );
  }
}

function parseCsv(buffer: Buffer): string {
  const text = buffer.toString("utf-8");
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new FileParseError(
      `Could not parse CSV: ${result.errors[0]?.message ?? "invalid format"}`
    );
  }

  if (result.data.length === 0) {
    return "";
  }

  const headers = result.meta.fields ?? Object.keys(result.data[0]);

  return result.data
    .map((row) =>
      headers.map((h) => `${h}: ${row[h] ?? ""}`).join(" | ")
    )
    .join("\n");
}

async function parseDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch {
    throw new FileParseError(
      "Could not extract text from this DOCX file — it may be corrupted."
    );
  }
}

/**
 * Parse JSON with Slack export detection.
 * Slack exports have a top-level `messages` array with `user` and `text` fields.
 */
function parseJsonWithDetection(buffer: Buffer): ParsedFileResult {
  let data: unknown;
  try {
    data = JSON.parse(buffer.toString("utf-8"));
  } catch {
    throw new FileParseError("Invalid JSON file — could not parse.");
  }

  if (isSlackExport(data)) {
    const content = restructureSlack(
      (data as SlackExport).messages
    );
    if (!content.trim()) {
      throw new FileParseError(
        "No content could be extracted from this file."
      );
    }
    return { parsed_content: content, source_format: "slack" };
  }

  const content =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);

  if (!content.trim()) {
    throw new FileParseError(
      "No content could be extracted from this file."
    );
  }

  return { parsed_content: content, source_format: "generic" };
}

// ---------------------------------------------------------------------------
// Chat format detection & restructuring
// ---------------------------------------------------------------------------

const WHATSAPP_LINE_REGEX =
  /^\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM|am|pm)?\]?\s?[-–—]?\s?(.+?):\s(.+)/;

function detectAndRestructure(
  content: string,
  mimeType: string
): ParsedFileResult {
  if (mimeType === "text/plain" || mimeType === "text/csv") {
    const lines = content.split("\n").filter((l) => l.trim());
    const matchCount = lines.filter((l) => WHATSAPP_LINE_REGEX.test(l)).length;

    if (lines.length > 0 && matchCount / lines.length > 0.5) {
      return {
        parsed_content: restructureWhatsApp(content),
        source_format: "whatsapp",
      };
    }
  }

  return { parsed_content: content, source_format: "generic" };
}

function restructureWhatsApp(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const match = line.match(WHATSAPP_LINE_REGEX);
      if (match) {
        const [, sender, message] = match;
        return `[${sender.trim()}]: ${message.trim()}`;
      }
      return line.trim() ? line.trim() : null;
    })
    .filter(Boolean)
    .join("\n");
}

interface SlackMessage {
  user?: string;
  text?: string;
  username?: string;
}

interface SlackExport {
  messages: SlackMessage[];
}

function isSlackExport(data: unknown): data is SlackExport {
  if (!data || typeof data !== "object") return false;

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.messages)) return false;
  if (obj.messages.length === 0) return false;

  const sample = obj.messages[0] as Record<string, unknown>;
  return typeof sample.text === "string" && (typeof sample.user === "string" || typeof sample.username === "string");
}

function restructureSlack(messages: SlackMessage[]): string {
  return messages
    .filter((m) => m.text?.trim())
    .map((m) => {
      const user = m.username || m.user || "Unknown";
      return `[${user}]: ${m.text!.trim()}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1) return "";
  return fileName.slice(lastDot).toLowerCase();
}
