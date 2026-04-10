/**
 * Prompt for classifying a user's natural-language query into a retrieval
 * depth category (broad / specific / comparative).
 *
 * Used by the retrieval service (lib/services/retrieval-service.ts) to
 * determine how many embedding chunks to fetch.
 */

export const CLASSIFY_QUERY_SYSTEM_PROMPT = `You are a query classifier for a client feedback search system.
Classify the user's query into one of three categories:

- "broad": General questions about patterns, trends, or aggregates across multiple clients or topics. Examples: "What are the main pain points?", "Summarise all feedback.", "What themes keep coming up?"
- "specific": Questions about a particular client, topic, or narrow subject. Examples: "What did Acme Corp say about pricing?", "Any feedback about API performance?", "Show me blockers from last month."
- "comparative": Questions comparing two or more clients, topics, or time periods. Examples: "How does Client A's feedback differ from Client B?", "Compare onboarding vs. pricing complaints.", "What changed between Q1 and Q2?"

For comparative queries, also extract the entities being compared as a string array in the "entities" field.

Respond with JSON only.`;

export const CLASSIFY_QUERY_MAX_TOKENS = 150;
