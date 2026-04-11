import { z } from "zod";

// ---------------------------------------------------------------------------
// Headline Insights LLM Response Schema (PRD-021 Part 5)
// ---------------------------------------------------------------------------

/** Schema for a single insight returned by the LLM. */
export const headlineInsightItemSchema = z.object({
  content: z
    .string()
    .min(1)
    .describe("A single-sentence headline insight (max ~120 chars)."),
  insightType: z
    .enum(["trend", "anomaly", "milestone"])
    .describe("Classification: trend, anomaly, or milestone."),
});

/** Schema for the full LLM response: an array of 3–5 insights. */
export const headlineInsightsResponseSchema = z
  .array(headlineInsightItemSchema)
  .min(1)
  .max(5);

export type HeadlineInsightsResponse = z.infer<
  typeof headlineInsightsResponseSchema
>;
