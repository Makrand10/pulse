import { config } from '../../config';

export interface SendEmailInput {
  to: string[];
  subject: string;
  html: string;
}

export interface EmailSender {
  sendEmail(input: SendEmailInput): Promise<void>;
}

// Resend implementation, wired over its REST API (no SDK needed for v1).
// Swappable via setEmailSender() so tests can inject a throwing/mock provider.
class ResendSender implements EmailSender {
  async sendEmail(input: SendEmailInput): Promise<void> {
    if (!config.resendApiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: input.to,
        subject: input.subject,
        html: input.html,
      }),
    });
    if (!res.ok) {
      throw new Error(`resend send failed (HTTP ${res.status}): ${await res.text()}`);
    }
  }
}

let active: EmailSender = new ResendSender();

export function setEmailSender(sender: EmailSender): EmailSender {
  const previous = active;
  active = sender;
  return previous;
}

export function getEmailSender(): EmailSender {
  return active;
}