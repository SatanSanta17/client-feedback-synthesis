// ---------------------------------------------------------------------------
// Dashboard Insight Types
// ---------------------------------------------------------------------------

/** The three insight classifications produced by the LLM. */
export type InsightType = "trend" | "anomaly" | "milestone";

/** A single AI-generated headline insight. */
export interface DashboardInsight {
  id: string;
  content: string;
  insightType: InsightType;
  batchId: string;
  teamId: string | null;
  createdBy: string;
  generatedAt: string;
}

/** A batch of insights sharing the same `batchId` and `generatedAt`. */
export interface InsightBatch {
  batchId: string;
  generatedAt: string;
  insights: DashboardInsight[];
}
