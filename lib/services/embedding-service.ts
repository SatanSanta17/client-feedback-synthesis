import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const EMBEDDING_BATCH_SIZE = 20;
const EMBEDDING_BATCH_DELAY_MS = 200;

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class EmbeddingServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingServiceError";
  }
}

export class EmbeddingConfigError extends EmbeddingServiceError {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingConfigError";
  }
}

export class EmbeddingRequestError extends EmbeddingServiceError {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingRequestError";
  }
}

export class EmbeddingRateLimitError extends EmbeddingServiceError {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingRateLimitError";
  }
}

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

interface EmbeddingProviderAdapter {
  embed(
    texts: string[],
    model: string,
    dimensions: number
  ): Promise<number[][]>;
}

type SupportedEmbeddingProvider = "openai";

const openaiAdapter: EmbeddingProviderAdapter = {
  async embed(texts, model, dimensions) {
    const client = new OpenAI(); // reads OPENAI_API_KEY from env
    const response = await client.embeddings.create({
      model,
      input: texts,
      dimensions,
    });
    // OpenAI guarantees response order matches input order
    return response.data.map((item) => item.embedding);
  },
};

const PROVIDER_MAP: Record<
  SupportedEmbeddingProvider,
  () => EmbeddingProviderAdapter
> = {
  openai: () => openaiAdapter,
};

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

interface ResolvedEmbeddingProvider {
  adapter: EmbeddingProviderAdapter;
  model: string;
  dimensions: number;
  label: string;
}

/**
 * Reads EMBEDDING_PROVIDER, EMBEDDING_MODEL, and EMBEDDING_DIMENSIONS from
 * environment variables and returns the corresponding adapter and config.
 */
function resolveEmbeddingProvider(): ResolvedEmbeddingProvider {
  const provider = process.env.EMBEDDING_PROVIDER;
  const model = process.env.EMBEDDING_MODEL;
  const dimensionsRaw = process.env.EMBEDDING_DIMENSIONS;

  if (!provider) {
    throw new EmbeddingConfigError(
      "EMBEDDING_PROVIDER environment variable is not set"
    );
  }
  if (!model) {
    throw new EmbeddingConfigError(
      "EMBEDDING_MODEL environment variable is not set"
    );
  }
  if (!dimensionsRaw) {
    throw new EmbeddingConfigError(
      "EMBEDDING_DIMENSIONS environment variable is not set"
    );
  }

  const dimensions = parseInt(dimensionsRaw, 10);
  if (isNaN(dimensions) || dimensions <= 0) {
    throw new EmbeddingConfigError(
      `EMBEDDING_DIMENSIONS must be a positive integer, got: "${dimensionsRaw}"`
    );
  }

  const factory = PROVIDER_MAP[provider as SupportedEmbeddingProvider];
  if (!factory) {
    throw new EmbeddingConfigError(
      `Unsupported EMBEDDING_PROVIDER: "${provider}". Supported: ${Object.keys(PROVIDER_MAP).join(", ")}`
    );
  }

  return {
    adapter: factory(),
    model,
    dimensions,
    label: `${provider}/${model}`,
  };
}

// ---------------------------------------------------------------------------
// Dimension validation (runs once on first successful embedding call)
// ---------------------------------------------------------------------------

let dimensionValidated = false;

function validateDimensions(
  actual: number,
  expected: number
): void {
  if (actual !== expected) {
    throw new EmbeddingConfigError(
      `Embedding dimension mismatch: provider returned ${actual}-dimensional vectors but EMBEDDING_DIMENSIONS is set to ${expected}. ` +
        `The session_embeddings column is vector(${expected}). ` +
        `Update EMBEDDING_DIMENSIONS or the database column to match.`
    );
  }
  dimensionValidated = true;
}

// ---------------------------------------------------------------------------
// Retry logic (mirrors ai-service.ts pattern, self-contained per SRP)
// ---------------------------------------------------------------------------

/**
 * Extracts Retry-After header value in milliseconds from an OpenAI error,
 * or returns null if not available.
 */
function getRetryAfterMs(err: unknown): number | null {
  if (
    err instanceof OpenAI.APIError &&
    err.headers &&
    typeof err.headers === "object"
  ) {
    const retryAfter =
      "retry-after" in err.headers
        ? (err.headers as Record<string, string>)["retry-after"]
        : null;
    if (retryAfter) {
      const seconds = parseFloat(retryAfter);
      if (!isNaN(seconds) && seconds > 0) {
        return seconds * 1000;
      }
    }
  }
  return null;
}

/**
 * Executes an async operation with retry logic for transient embedding failures.
 */
async function withEmbeddingRetry<T>(
  operationName: string,
  fn: (attempt: number) => Promise<T>
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Non-retryable config errors — throw immediately
      if (err instanceof EmbeddingConfigError) {
        throw err;
      }

      const statusCode =
        err instanceof OpenAI.APIError ? err.status : undefined;

      // Don't retry client errors (4xx except 429)
      if (
        statusCode !== undefined &&
        statusCode < 500 &&
        statusCode !== 429
      ) {
        console.error(
          `[embedding-service] ${operationName} — client error (${statusCode}, not retrying):`,
          lastError.message
        );
        throw new EmbeddingRequestError(
          `Embedding provider rejected the request: ${lastError.message}`
        );
      }

      if (attempt >= MAX_RETRIES) {
        console.error(
          `[embedding-service] ${operationName} — failed after ${attempt + 1} attempts:`,
          lastError.message
        );
        if (statusCode === 429) {
          throw new EmbeddingRateLimitError(
            `${operationName} rate limited after ${attempt + 1} attempts: ${lastError.message}`
          );
        }
        throw new EmbeddingServiceError(
          `${operationName} failed after ${attempt + 1} attempts: ${lastError.message}`
        );
      }

      // Determine delay: Retry-After for 429, exponential backoff otherwise
      let delay: number;
      if (statusCode === 429) {
        const retryAfterMs = getRetryAfterMs(err);
        delay = retryAfterMs ?? INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[embedding-service] ${operationName} — rate limited (429), retrying in ${delay}ms (attempt ${attempt + 1}):`,
          lastError.message
        );
      } else {
        delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[embedding-service] ${operationName} — retryable error (attempt ${attempt + 1}), retrying in ${delay}ms:`,
          lastError.message
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new EmbeddingServiceError(
    `${operationName} failed: ${lastError?.message ?? "unknown error"}`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Converts an array of text strings into embedding vectors using the
 * configured embedding provider. Processes in batches to respect rate limits.
 *
 * @param texts - Array of strings to embed.
 * @returns Array of embedding vectors in the same order as the input texts.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const { adapter, model, dimensions, label } = resolveEmbeddingProvider();

  console.log(
    `[embedding-service] embedTexts — ${texts.length} texts, model: ${label}, batchSize: ${EMBEDDING_BATCH_SIZE}`
  );

  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchIndex = Math.floor(i / EMBEDDING_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(texts.length / EMBEDDING_BATCH_SIZE);

    const batchEmbeddings = await withEmbeddingRetry(
      `embedTexts batch ${batchIndex}/${totalBatches}`,
      async () => {
        console.log(
          `[embedding-service] embedTexts — batch ${batchIndex}/${totalBatches} (${batch.length} texts)`
        );
        return adapter.embed(batch, model, dimensions);
      }
    );

    // Validate dimensions on first successful batch
    if (!dimensionValidated && batchEmbeddings.length > 0) {
      validateDimensions(batchEmbeddings[0].length, dimensions);
    }

    allEmbeddings.push(...batchEmbeddings);

    // Inter-batch delay to avoid rate limits (skip after last batch)
    if (i + EMBEDDING_BATCH_SIZE < texts.length) {
      await new Promise((resolve) =>
        setTimeout(resolve, EMBEDDING_BATCH_DELAY_MS)
      );
    }
  }

  console.log(
    `[embedding-service] embedTexts — complete, ${allEmbeddings.length} embeddings generated`
  );

  return allEmbeddings;
}
