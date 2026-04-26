import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/route-auth";
import { validateFileUpload } from "@/lib/api/file-validation";
import {
  parseFile,
  FileParseError,
} from "@/lib/services/file-parser-service";

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

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

  const validation = validateFileUpload(file);
  if (!validation.valid) {
    console.warn(
      `[api/files/parse] POST — rejected: ${validation.message}`
    );
    return NextResponse.json({ message: validation.message }, { status: 400 });
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
