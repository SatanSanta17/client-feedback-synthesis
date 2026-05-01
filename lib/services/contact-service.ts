import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/services/email-service";

interface PersistInput {
  name: string;
  email: string;
  mobile: string | null;
  message: string;
  userAgent: string | null;
  ipAddress: string | null;
}

interface NotifyInput {
  name: string;
  email: string;
  mobile: string | null;
  message: string;
}

interface NotifyOutcome {
  status: "sent" | "failed";
}

/**
 * Persists a contact-form submission via the service-role Supabase
 * client. Bypasses RLS by design — the table denies all client reads
 * and writes; only this service-role path inserts rows.
 *
 * Returns the new row's id. Throws if the insert fails — the route
 * handler translates the throw into a 500 response.
 */
export async function persistSubmission(input: PersistInput): Promise<{ id: string }> {
  console.log(
    `[contact-service] persistSubmission — name length: ${input.name.length}, ` +
      `email domain: @${input.email.split("@")[1] ?? "unknown"}, ` +
      `mobile: ${input.mobile ? "present" : "absent"}, ` +
      `message length: ${input.message.length}, ` +
      `userAgent: ${input.userAgent ? "present" : "absent"}, ` +
      `ipAddress: ${input.ipAddress ? "present" : "absent"}`
  );

  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("contact_submissions")
    .insert({
      name: input.name,
      email: input.email,
      mobile: input.mobile,
      message: input.message,
      user_agent: input.userAgent,
      ip_address: input.ipAddress,
    })
    .select("id")
    .single();

  if (error || !data) {
    const message = error?.message ?? "insert returned no row";
    console.error(`[contact-service] persistSubmission failed: ${message}`, error);
    throw new Error(`Failed to persist contact submission: ${message}`);
  }

  console.log(`[contact-service] persistSubmission — persisted id: ${data.id}`);
  return { id: data.id };
}

/**
 * Sends an email notification to the operator about a new contact
 * submission. Reply-to is set to the submitter's email so the operator
 * can reply directly from their inbox.
 *
 * Never throws — returns `{ status: "failed" }` if Resend/Brevo errors.
 * The submission is durably persisted before this is called, so a
 * notification failure is recoverable from the database.
 */
export async function notifyOperator(input: NotifyInput): Promise<NotifyOutcome> {
  const operatorEmail = process.env.CONTACT_OPERATOR_EMAIL;
  if (!operatorEmail) {
    console.error(
      "[contact-service] notifyOperator — CONTACT_OPERATOR_EMAIL is not set; skipping notification"
    );
    return { status: "failed" };
  }

  console.log(
    `[contact-service] notifyOperator — to: ${operatorEmail}, ` +
      `replyTo domain: @${input.email.split("@")[1] ?? "unknown"}`
  );

  const subject = `New contact submission from ${input.name}`;
  const html = buildNotificationHtml(input);

  try {
    await sendEmail({
      to: operatorEmail,
      subject,
      html,
      replyTo: input.email,
    });
    console.log(`[contact-service] notifyOperator — sent`);
    return { status: "sent" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[contact-service] notifyOperator — failed: ${message}`, err);
    return { status: "failed" };
  }
}

function buildNotificationHtml({ name, email, mobile, message }: NotifyInput): string {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br />");
  const mobileLine = mobile
    ? `<p style="margin: 0 0 8px 0;"><strong>Mobile:</strong> ${escapeHtml(mobile)}</p>`
    : "";

  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 560px;">
      <h2 style="margin: 0 0 16px 0; font-size: 18px;">New contact submission</h2>
      <p style="margin: 0 0 8px 0;"><strong>From:</strong> ${safeName} &lt;${safeEmail}&gt;</p>
      ${mobileLine}
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 16px 0;" />
      <p style="margin: 0; white-space: pre-wrap;">${safeMessage}</p>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
