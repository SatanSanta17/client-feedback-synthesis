const INVITE_EXPIRY_DAYS = 7;

export function buildInviteEmailHtml(params: {
  teamName: string;
  inviterEmail: string;
  role: string;
  inviteUrl: string;
}): string {
  const { teamName, inviterEmail, role, inviteUrl } = params;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">You're invited to join ${teamName}</h2>
      <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 8px;">
        ${inviterEmail} invited you to join <strong>${teamName}</strong> on Synthesiser.
      </p>
      <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        You've been invited as <strong>${role}</strong>.
      </p>
      <a href="${inviteUrl}" style="display: inline-block; background: #4f46e5; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 15px; font-weight: 500;">
        Join Team
      </a>
      <p style="color: #999; font-size: 13px; margin-top: 24px;">
        This invitation expires in ${INVITE_EXPIRY_DAYS} days.
      </p>
    </div>
  `;
}
