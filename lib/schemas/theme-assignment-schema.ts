import { z } from "zod";

// ---------------------------------------------------------------------------
// Theme Assignment Schema — used with generateObject() for LLM response
// ---------------------------------------------------------------------------

export const themeAssignmentItemSchema = z.object({
  signalIndex: z
    .number()
    .int()
    .min(0)
    .describe("Zero-based index of the signal in the input list"),
  themes: z
    .array(
      z.object({
        themeName: z
          .string()
          .min(1)
          .max(100)
          .describe("Human-readable theme label (2-4 words, topic-based)"),
        isNew: z
          .boolean()
          .describe("True if this theme does not exist in the provided list"),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .describe("Assignment confidence: 0.8-1.0 primary, 0.5-0.7 secondary, 0.3-0.7 raw"),
        description: z
          .string()
          .max(200)
          .optional()
          .describe("One-sentence description of what this theme covers (new themes only)"),
      })
    )
    .min(1)
    .describe("One primary theme (highest confidence) and optional secondary themes"),
});

export const themeAssignmentResponseSchema = z.object({
  assignments: z
    .array(themeAssignmentItemSchema)
    .describe("One entry per signal from the input list"),
});

export type ThemeAssignmentResponse = z.infer<typeof themeAssignmentResponseSchema>;
