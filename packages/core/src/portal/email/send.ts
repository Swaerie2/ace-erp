export type EmailAttachment = { filename: string; content: Uint8Array };
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: readonly EmailAttachment[];
};

export const MAX_ATTACHMENTS = 20;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const SAFE_FILENAME = /^[A-Za-z0-9._-]{1,100}$/;

/** Throws a fixed-words error when the attachments cannot be sent. Never names a file or a person. */
export function checkAttachments(list: readonly EmailAttachment[] = []): void {
  if (list.length > MAX_ATTACHMENTS) throw new Error("Too many email attachments.");
  if (list.some((a) => !SAFE_FILENAME.test(a.filename) || a.filename.startsWith("."))) {
    throw new Error("An email attachment name is not allowed.");
  }
  if (list.reduce((t, a) => t + a.content.byteLength, 0) > MAX_ATTACHMENT_BYTES) {
    throw new Error("The email attachments are too large.");
  }
}

export type EmailDriver = { kind: "resend"; apiKey: string; from: string } | { kind: "console" };

const RESEND_URL = "https://api.resend.com/emails";

/**
 * How email goes out. With RESEND_API_KEY: through Resend (EMAIL_FROM is then required). Without it:
 * printed to the server console only when NODE_ENV is "development" or "test", and a loud failure for any
 * other value (production, or NODE_ENV not set at all).
 */
export function emailDriver(env: NodeJS.ProcessEnv = process.env): EmailDriver {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (apiKey) {
    const from = env.EMAIL_FROM?.trim();
    if (!from)
      throw new Error("EMAIL_FROM is not set. It is needed to send emails through Resend.");
    return { kind: "resend", apiKey, from };
  }
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    throw new Error("RESEND_API_KEY is not set. In production emails must be sent through Resend.");
  }
  return { kind: "console" };
}

/**
 * Throws the same fixed-words error as sending would, so a server can refuse to start with email
 * misconfigured (production without RESEND_API_KEY or EMAIL_FROM). Never includes a value.
 */
export function assertEmailConfigured(env: NodeJS.ProcessEnv = process.env): void {
  emailDriver(env);
}

/** Sends one email. The error, if any, never contains the recipient's address. */
export async function sendEmail(
  message: EmailMessage,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; log?: (text: string) => void } = {},
): Promise<void> {
  const attachments = message.attachments ?? [];
  checkAttachments(attachments);
  const driver = emailDriver(opts.env);
  if (driver.kind === "console") {
    const files = attachments.map(
      (a) =>
        `Attachments: ${a.filename} (${Math.max(1, Math.ceil(a.content.byteLength / 1024))} KB)`,
    );
    (opts.log ?? console.info)(
      [
        `[email: development only, not sent]\nTo: ${message.to}\nSubject: ${message.subject}`,
        ...files,
        "",
        message.text,
      ].join("\n"),
    );
    return;
  }
  const res = await (opts.fetchImpl ?? fetch)(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${driver.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: driver.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(attachments.length > 0
        ? {
            attachments: attachments.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.content).toString("base64"),
            })),
          }
        : {}),
    }),
    signal: AbortSignal.timeout(attachments.length > 0 ? 30_000 : 10_000),
  });
  if (!res.ok) throw new Error(`The email could not be sent (Resend answered ${res.status}).`);
}
