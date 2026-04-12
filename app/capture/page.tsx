import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { CapturePageContent } from "./_components/capture-page-content";

export const metadata: Metadata = {
  title: "Capture | Synthesiser",
  description: "Capture and structure client session notes",
};

export default function CapturePage() {
  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <PageHeader title="Capture" className="w-full max-w-4xl" />
      <CapturePageContent />
    </div>
  );
}
