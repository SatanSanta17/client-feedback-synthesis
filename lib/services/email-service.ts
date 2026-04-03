import { Resend } from "resend";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

interface EmailProvider {
  send(payload: EmailPayload): Promise<void>;
}

// ---------------------------------------------------------------------------
// Provider adapters
// ---------------------------------------------------------------------------

type SupportedEmailProvider = "resend";

function createResendProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new EmailConfigError("RESEND_API_KEY environment variable is not set");
  }

  const resend = new Resend(apiKey);
  const from =
    process.env.EMAIL_FROM ?? "Synthesiser <noreply@synthesiser.app>";

  return {
    async send({ to, subject, html }) {
      const { error } = await resend.emails.send({ from, to, subject, html });
      if (error) {
        throw new EmailSendError(`Resend error: ${error.message}`);
      }
    },
  };
}

const PROVIDER_MAP: Record<SupportedEmailProvider, () => EmailProvider> = {
  resend: createResendProvider,
};

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

function resolveEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER;

  if (!provider) {
    throw new EmailConfigError(
      "EMAIL_PROVIDER environment variable is not set"
    );
  }

  const factory = PROVIDER_MAP[provider as SupportedEmailProvider];
  if (!factory) {
    throw new EmailConfigError(
      `Unsupported EMAIL_PROVIDER: "${provider}". Supported: ${Object.keys(PROVIDER_MAP).join(", ")}`
    );
  }

  return factory();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends an email via the configured provider.
 * Reads EMAIL_PROVIDER from environment variables and delegates to the
 * matching adapter. Adding a new provider requires only a new adapter
 * function and an entry in PROVIDER_MAP.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  const provider = resolveEmailProvider();

  console.log(
    `[email-service] Sending email to ${payload.to} — subject: "${payload.subject}"`
  );

  try {
    await provider.send(payload);
    console.log(`[email-service] Email sent successfully to ${payload.to}`);
  } catch (err) {
    if (err instanceof EmailConfigError || err instanceof EmailSendError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email-service] Unexpected error sending email:`, message);
    throw new EmailSendError(`Failed to send email: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class EmailServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailServiceError";
  }
}

export class EmailConfigError extends EmailServiceError {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

export class EmailSendError extends EmailServiceError {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}
