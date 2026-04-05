import {
  FileText,
  FileSpreadsheet,
  FileJson2,
  FileType2,
} from "lucide-react";

export const FILE_ICONS: Record<string, React.ElementType> = {
  "text/plain": FileText,
  "text/csv": FileSpreadsheet,
  "application/pdf": FileType2,
  "application/json": FileJson2,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    FileText,
};
