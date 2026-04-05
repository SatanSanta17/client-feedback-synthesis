import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  parseFile,
  FileParseError,
} from "@/lib/services/file-parser-service";
import {
  MAX_FILE_SIZE_BYTES,
  ACCEPTED_FILE_TYPES,
} from "@/lib/constants";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn("[api/files/parse] POST — unauthenticated request");
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

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

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { message: "No file provided" },
      { status: 400 }
    );
  }

  const fileName = file.name;
  const fileType = file.type;
  const fileSize = file.size;

  console.log(
    `[api/files/parse] POST — parsing "${fileName}" (${fileType}, ${fileSize} bytes)`
  );

  if (fileSize > MAX_FILE_SIZE_BYTES) {
    console.warn(
      `[api/files/parse] POST — file too large: ${fileSize} bytes`
    );
    return NextResponse.json(
      { message: "File exceeds 10MB limit" },
      { status: 400 }
    );
  }

  if (!(fileType in ACCEPTED_FILE_TYPES)) {
    console.warn(
      `[api/files/parse] POST — unsupported type: ${fileType}`
    );
    return NextResponse.json(
      { message: `Unsupported file type: ${fileType}` },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await parseFile(buffer, fileName, fileType);

    console.log(
      `[api/files/parse] POST — parsed ${result.parsed_content.length} chars, format: ${result.source_format}`
    );

    return NextResponse.json({
      parsed_content: result.parsed_content,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
      source_format: result.source_format,
    });
  } catch (err) {
    if (err instanceof FileParseError) {
      console.warn(`[api/files/parse] POST — parse error: ${err.message}`);
      return NextResponse.json(
        { message: err.message },
        { status: 422 }
      );
    }

    console.error(
      "[api/files/parse] POST — unexpected error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to parse file" },
      { status: 500 }
    );
  }
}
