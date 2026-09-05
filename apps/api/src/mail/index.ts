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

/** Local development: log the link (the token is the credential; local logs stay on the laptop). */
export class LogMailer implements Mailer {
  constructor(private readonly logger: Logger) {}
  async sendInvitation(mail: InvitationMail): Promise<void> {
    this.logger.info(
      { to: mail.to, organization: mail.organizationName, accept_url: mail.acceptUrl },
      "invitation email (not sent: APP_ENV=local)",
    );
  }
}

/** Platform transactional mail through Postmark. Invitations, resets, notices — never client or insurer mail. */
export class PostmarkMailer implements Mailer {
  constructor(
    private readonly config: { serverToken: string; from: string; messageStream: string },
    private readonly logger: Logger,
  ) {}

  async sendInvitation(mail: InvitationMail): Promise<void> {
    const expires = mail.expiresAt.toUTCString();
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.config.serverToken,
      },
      body: JSON.stringify({
        From: this.config.from,
        To: mail.to,
        MessageStream: this.config.messageStream,
        Subject: `${mail.inviterName} invited you to ${mail.organizationName} on ASAP`,
        TextBody:
          `${mail.inviterName} has invited you to join ${mail.organizationName} on ASAP as ${mail.roleName}.\n\n` +
          `Accept the invitation:\n${mail.acceptUrl}\n\n` +
          `This link expires on ${expires}. If you were not expecting it, ignore this email.\n`,
        HtmlBody:
          `<p>${escapeHtml(mail.inviterName)} has invited you to join <strong>${escapeHtml(mail.organizationName)}</strong> on ASAP as ${escapeHtml(mail.roleName)}.</p>` +
          `<p><a href="${mail.acceptUrl}">Accept the invitation</a></p>` +
          `<p>This link expires on ${expires}. If you were not expecting it, ignore this email.</p>`,
        Tag: "invitation",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.logger.error(
        { status: res.status, body: text.slice(0, 500) },
        "postmark rejected the email",
      );
      throw new Error(`postmark_error_${res.status}`);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}
