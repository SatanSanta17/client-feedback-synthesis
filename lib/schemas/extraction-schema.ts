import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema version — stored with every extraction for forward-compatible migrations
// ---------------------------------------------------------------------------

export const EXTRACTION_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Reusable sub-schemas (P1.R2)
// ---------------------------------------------------------------------------

const severityEnum = z.enum(["low", "medium", "high"]);

export const signalChunkSchema = z.object({
  text: z.string().describe("Distilled signal statement"),
  clientQuote: z
    .string()
    .nullable()
    .describe(
      "Direct quote from the raw notes, or null if none exists. Never fabricate."
    ),
  severity: severityEnum.describe(
    "Signal severity. Default to 'medium' if not determinable from the notes."
  ),
});

const sentimentEnum = z.enum(["positive", "neutral", "negative"]);

export const competitiveMentionSchema = z.object({
  competitor: z.string().describe("Name of the competitor"),
  context: z.string().describe("What was said about them"),
  sentiment: sentimentEnum.describe("Sentiment toward this competitor"),
});

const toolTypeEnum = z.enum(["tool", "platform", "competitor"]);

export const toolAndPlatformSchema = z.object({
  name: z.string().describe("Name of the tool or platform"),
  context: z.string().describe("How the client uses or references it"),
  type: toolTypeEnum.describe("Classification of this entry"),
});

const requirementPriorityEnum = z.enum(["must", "should", "nice"]);

export const requirementChunkSchema = signalChunkSchema.extend({
  priority: requirementPriorityEnum.describe(
    "Requirement priority: must-have, should-have, or nice-to-have"
  ),
});

// ---------------------------------------------------------------------------
// Full extraction schema (P1.R1)
// ---------------------------------------------------------------------------

export const extractionSchema = z.object({
  schemaVersion: z
    .literal(EXTRACTION_SCHEMA_VERSION)
    .describe("Schema version — always 1 for this version"),
  summary: z.string().describe("2–3 sentence overview of the session"),
  sentiment: z
    .enum(["positive", "neutral", "negative", "mixed"])
    .describe("Overall session sentiment"),
  urgency: z
    .enum(["low", "medium", "high", "critical"])
    .describe("Urgency level derived from the session"),
  decisionTimeline: z
    .string()
    .nullable()
    .describe("Decision timeline if mentioned, null otherwise"),
  clientProfile: z.object({
    industry: z
      .string()
      .nullable()
      .describe("Industry or vertical, null if not mentioned"),
    geography: z
      .string()
      .nullable()
      .describe("Market or geography, null if not mentioned"),
    budgetRange: z
      .string()
      .nullable()
      .describe("Budget range, null if not mentioned"),
  }),
  painPoints: z
    .array(signalChunkSchema)
    .describe("Pain points — empty array if none"),
  requirements: z
    .array(requirementChunkSchema)
    .describe("Requirements with priority — empty array if none"),
  aspirations: z
    .array(signalChunkSchema)
    .describe("Aspirational wants — empty array if none"),
  competitiveMentions: z
    .array(competitiveMentionSchema)
    .describe("Competitor mentions — empty array if none"),
  blockers: z
    .array(signalChunkSchema)
    .describe("Blockers and dependencies — empty array if none"),
  toolsAndPlatforms: z
    .array(toolAndPlatformSchema)
    .describe("Tools, platforms, and channels — empty array if none"),
  custom: z
    .record(z.string(), z.array(signalChunkSchema))
    .describe(
      "Custom categories from user prompt guidance. Keys are category names, values are signal chunk arrays. Empty object if no custom categories."
    ),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type SignalChunk = z.infer<typeof signalChunkSchema>;
export type RequirementChunk = z.infer<typeof requirementChunkSchema>;
export type CompetitiveMention = z.infer<typeof competitiveMentionSchema>;
export type ToolAndPlatform = z.infer<typeof toolAndPlatformSchema>;
export type ExtractedSignals = z.infer<typeof extractionSchema>;
