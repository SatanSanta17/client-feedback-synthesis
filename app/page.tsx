import type { Metadata } from "next";
import { LandingPage } from "./_components/landing-page";

export const metadata: Metadata = {
  title: "Synthesiser — Turn Client Conversations into Product Signals",
  description:
    "AI-powered client feedback capture and synthesis for sales and product teams. Extract signals, spot cross-client themes, and never lose an insight again.",
};

export default function HomePage() {
  return <LandingPage />;
}
