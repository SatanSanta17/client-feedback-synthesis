import { NextRequest, NextResponse } from "next/server";

import {
  uploadAndCreateAttachment,
  getAttachmentCountForSession,
} from "@/lib/services/attachment-service";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_ATTACHMENTS,
  ACCEPTED_FILE_TYPES,
} from "@/lib/constants";
import { checkSessionWriteAccess } from "@/app/api/sessions/_helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  console.log("[api/sessions/[id]/attachments] POST — session:", sessionId);

  const access = await checkSessionWriteAccess(sessionId);
  if (access.error) return access.error;

  const { teamId } = access;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { message: "Invalid form data" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  const parsedContent = formData.get("parsed_content");
  const sourceFormat = formData.get("source_format");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { message: "No file provided" },
      { status: 400 }
    );
  }

  if (typeof parsedContent !== "string" || !parsedContent.trim()) {
    return NextResponse.json(
      { message: "parsed_content is required" },
      { status: 400 }
    );
  }

  if (typeof sourceFormat !== "string") {
    return NextResponse.json(
      { message: "source_format is required" },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { message: `File exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit` },
      { status: 400 }
    );
  }

  if (!ACCEPTED_FILE_TYPES[file.type]) {
    return NextResponse.json(
      { message: `Unsupported file type: ${file.type}` },
      { status: 400 }
    );
  }

  const currentCount = await getAttachmentCountForSession(sessionId);
  if (currentCount >= MAX_ATTACHMENTS) {
    return NextResponse.json(
      { message: `Maximum ${MAX_ATTACHMENTS} attachments per session` },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    const attachment = await uploadAndCreateAttachment({
      sessionId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      parsedContent,
      sourceFormat,
      fileBuffer: buffer,
      teamId,
    });

    console.log(
      "[api/sessions/[id]/attachments] POST — created:",
      attachment.id
    );
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (err) {
    console.error(
      "[api/sessions/[id]/attachments] POST error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to upload attachment" },
      { status: 500 }
    );
  }
}
