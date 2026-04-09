import type {
  ExtractedSignals,
  SignalChunk,
  CompetitiveMention,
  ToolAndPlatform,
  RequirementChunk,
} from "@/lib/schemas/extraction-schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function renderSignalChunks(chunks: SignalChunk[]): string {
  if (chunks.length === 0) {
    return "No signals identified.\n";
  }

  return chunks
    .map((chunk) => {
      const quote = chunk.clientQuote ? ` — *"${chunk.clientQuote}"*` : "";
      return `- ${chunk.text}${quote}`;
    })
    .join("\n") + "\n";
}

function renderRequirementChunks(chunks: RequirementChunk[]): string {
  if (chunks.length === 0) {
    return "No signals identified.\n";
  }

  return chunks
    .map((chunk) => {
      const quote = chunk.clientQuote ? ` — *"${chunk.clientQuote}"*` : "";
      return `- [${capitalize(chunk.priority)}] ${chunk.text}${quote}`;
    })
    .join("\n") + "\n";
}

function renderCompetitiveMentions(mentions: CompetitiveMention[]): string {
  if (mentions.length === 0) {
    return "No signals identified.\n";
  }

  return mentions
    .map(
      (m) => `- **${m.competitor}** (${capitalize(m.sentiment)}): ${m.context}`
    )
    .join("\n") + "\n";
}

function renderToolsAndPlatforms(tools: ToolAndPlatform[]): string {
  if (tools.length === 0) {
    return "No signals identified.\n";
  }

  return tools
    .map((t) => `- **${t.name}** (${capitalize(t.type)}): ${t.context}`)
    .join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Converts an ExtractedSignals object to the markdown format that matches the
 * output structure of the original signal extraction prompt. This keeps the
 * `structured_notes` column backward-compatible while the primary output
 * migrates to JSON (PRD-018 P1.R4).
 */
export function renderExtractedSignalsToMarkdown(
  signals: ExtractedSignals
): string {
  const lines: string[] = [];

  // --- Section 1: Session Overview ---

  lines.push("## Session Summary\n");
  lines.push(`${signals.summary}\n`);

  lines.push("## Sentiment\n");
  lines.push(`**Overall:** ${capitalize(signals.sentiment)}\n`);

  lines.push("## Urgency\n");
  lines.push(`**Level:** ${capitalize(signals.urgency)}\n`);

  lines.push("## Decision Timeline\n");
  lines.push(
    `**Timeline:** ${signals.decisionTimeline ?? "Not mentioned"}\n`
  );

  // --- Section 2: Client Profile ---

  lines.push("## Client Profile\n");
  lines.push(
    `- **Industry / Vertical:** ${signals.clientProfile.industry ?? "Not mentioned"}`
  );
  lines.push(
    `- **Market / Geography:** ${signals.clientProfile.geography ?? "Not mentioned"}`
  );
  lines.push(
    `- **Budget / Spend:** ${signals.clientProfile.budgetRange ?? "Not mentioned"}\n`
  );

  // --- Section 3: Signal Categories ---

  lines.push("## Pain Points\n");
  lines.push(renderSignalChunks(signals.painPoints));

  lines.push("## Must-Haves / Requirements\n");
  lines.push(renderRequirementChunks(signals.requirements));

  lines.push("## Aspirations\n");
  lines.push(renderSignalChunks(signals.aspirations));

  lines.push("## Competitive Mentions\n");
  lines.push(renderCompetitiveMentions(signals.competitiveMentions));

  lines.push("## Blockers / Dependencies\n");
  lines.push(renderSignalChunks(signals.blockers));

  lines.push("## Platforms & Channels\n");
  lines.push(renderToolsAndPlatforms(signals.toolsAndPlatforms));

  // --- Custom categories ---

  if (signals.custom.length > 0) {
    for (const category of signals.custom) {
      lines.push(`## ${category.categoryName}\n`);
      lines.push(renderSignalChunks(category.signals));
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}
