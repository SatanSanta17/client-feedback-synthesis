import type { Metadata } from "next";
import { MasterSignalPageContent } from "./_components/master-signal-page-content";

export const metadata: Metadata = {
  title: "Master Signals | Synthesiser",
  description:
    "AI-synthesised cross-client signal analysis from all session extractions",
};

export default function MasterSignalsPage() {
  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <MasterSignalPageContent />
    </div>
  );
}
