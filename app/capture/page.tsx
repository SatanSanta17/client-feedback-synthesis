import type { Metadata } from "next";
import { CapturePageContent } from "./_components/capture-page-content";

export const metadata: Metadata = {
  title: "Capture | Accelerate Synthesis",
  description: "Capture and structure client session notes",
};

export default function CapturePage() {
  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <CapturePageContent />
    </div>
  );
}
