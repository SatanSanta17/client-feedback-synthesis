import { z } from "zod";

/**
 * Public landing-page contact form schema. Shared between the form
 * (client) and the /api/contact route (server) so validation rules
 * never drift between the two surfaces.
 *
 * The `website` field is a honeypot — it is `display: none` and
 * `tab-index="-1"` in the rendered form, so humans never see or fill
 * it. Bots that fill every field hit it; the route absorbs those
 * submissions silently (returns 200 without persisting or notifying)
 * per PRD-030 P3.R9.
 */
export const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or fewer"),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(254, "Email must be 254 characters or fewer"),
  mobile: z
    .string()
    .trim()
    .max(30, "Mobile number must be 30 characters or fewer")
    .optional(),
  message: z
    .string()
    .trim()
    .min(1, "Message is required")
    .max(2000, "Message must be 2000 characters or fewer"),
  // Honeypot field — Zod accepts any string so bots that fill it pass
  // validation; the route handler checks `length > 0` and silently
  // absorbs the submission (returns 200 without persisting or notifying).
  // A `max(0)` constraint here would 400-reject bots, which is *more*
  // stealthy than silent-200 absorb but breaks PRD-030 P3.R9.
  website: z.string().optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;
