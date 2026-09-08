import type { Logger } from "pino";

export type InvitationMail = {
  to: string;
  organizationName: string;
  roleName: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: Date;
};

export interface Mailer {
  sendInvitation(mail: InvitationMail): Promise<void>;
}

/**
 * Email is not configured. Invitations are recorded and the accept link is logged at info
 * level (the token is the credential, so this is only acceptable where logs stay private).
 * Used locally, and in staging when RESEND_API_KEY is absent (D-046).
 */
export class LogMailer implements Mailer {
  constructor(private readonly logger: Logger) {}
  async sendInvitation(mail: InvitationMail): Promise<void> {
    this.logger.info(
      { to: mail.to, organization: mail.organizationName, accept_url: mail.acceptUrl },
      "invitation email not sent: email transport disabled",
    );
  }
}

/**
 * Platform transactional mail through Resend: invitations, resets, notices. Never client or
 * insurer mail — those are drafted and sent by a person (UI Build Spec v1 Part 7). The only
 * automatic external messages are the informational ones a brokerage explicitly turns on.
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly config: { apiKey: string; from: string },
    private readonly logger: Logger,
  ) {}

  async sendInvitation(mail: InvitationMail): Promise<void> {
    const expires = mail.expiresAt.toUTCString();
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [mail.to],
        subject: `${mail.inviterName} invited you to ${mail.organizationName} on ASAP`,
        text:
          `${mail.inviterName} has invited you to join ${mail.organizationName} on ASAP as ${mail.roleName}.\n\n` +
          `Accept the invitation:\n${mail.acceptUrl}\n\n` +
          `This link expires on ${expires}. If you were not expecting it, ignore this email.\n`,
        html:
          `<p>${escapeHtml(mail.inviterName)} has invited you to join <strong>${escapeHtml(mail.organizationName)}</strong> on ASAP as ${escapeHtml(mail.roleName)}.</p>` +
          `<p><a href="${mail.acceptUrl}">Accept the invitation</a></p>` +
          `<p>This link expires on ${expires}. If you were not expecting it, ignore this email.</p>`,
        tags: [{ name: "kind", value: "invitation" }],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.logger.error(
        { status: res.status, body: text.slice(0, 500) },
        "resend rejected the email",
      );
      throw new Error(`resend_error_${res.status}`);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}
