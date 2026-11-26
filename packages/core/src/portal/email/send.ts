export type EmailMessage = { to: string; subject: string; text: string; html: string };

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
  const driver = emailDriver(opts.env);
  if (driver.kind === "console") {
    (opts.log ?? console.info)(
      `[email: development only, not sent]\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
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
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`The email could not be sent (Resend answered ${res.status}).`);
}
