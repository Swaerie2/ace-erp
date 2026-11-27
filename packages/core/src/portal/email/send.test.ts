import { describe, expect, it, vi } from "vitest";
import { assertEmailConfigured, emailDriver, sendEmail, type EmailMessage } from "./send";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
const message: EmailMessage = {
  to: "zz.client@example.com",
  subject: "Your ACE sign-in code",
  text: "Your code is 123456",
  html: "<p>Your code is 123456</p>",
};

describe("emailDriver", () => {
  it("prints to the console in development when there is no key", () => {
    expect(emailDriver(env({ NODE_ENV: "development" }))).toEqual({ kind: "console" });
  });
  it("prints to the console under test", () => {
    expect(emailDriver(env({ NODE_ENV: "test" }))).toEqual({ kind: "console" });
  });
  it("fails loudly without a key unless NODE_ENV is development or test", () => {
    for (const nodeEnv of [undefined, "", "staging", "Production"]) {
      const values: Record<string, string> = nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv };
      expect(() => emailDriver(env(values)), String(nodeEnv)).toThrow(
        "RESEND_API_KEY is not set. In production emails must be sent through Resend.",
      );
    }
  });
  it("fails loudly in production without a key", () => {
    expect(() => emailDriver(env({ NODE_ENV: "production" }))).toThrow(
      "RESEND_API_KEY is not set. In production emails must be sent through Resend.",
    );
  });
  it("needs a sender when a key is set", () => {
    expect(() => emailDriver(env({ NODE_ENV: "production", RESEND_API_KEY: "re_test" }))).toThrow(
      "EMAIL_FROM is not set. It is needed to send emails through Resend.",
    );
    expect(
      emailDriver(
        env({
          NODE_ENV: "production",
          RESEND_API_KEY: "re_test",
          EMAIL_FROM: "ACE <noreply@example.com>",
        }),
      ),
    ).toEqual({ kind: "resend", apiKey: "re_test", from: "ACE <noreply@example.com>" });
  });
});

describe("assertEmailConfigured", () => {
  it("passes in development and under test without a key", () => {
    expect(() => assertEmailConfigured(env({ NODE_ENV: "development" }))).not.toThrow();
    expect(() => assertEmailConfigured(env({ NODE_ENV: "test" }))).not.toThrow();
  });
  it("throws in production without a key or without a sender", () => {
    expect(() => assertEmailConfigured(env({ NODE_ENV: "production" }))).toThrow(
      "RESEND_API_KEY is not set.",
    );
    expect(() =>
      assertEmailConfigured(env({ NODE_ENV: "production", RESEND_API_KEY: "re_test" })),
    ).toThrow("EMAIL_FROM is not set.");
  });
  it("passes in production with a key and a sender", () => {
    expect(() =>
      assertEmailConfigured(
        env({
          NODE_ENV: "production",
          RESEND_API_KEY: "re_test",
          EMAIL_FROM: "ACE <noreply@example.com>",
        }),
      ),
    ).not.toThrow();
  });
});

describe("sendEmail", () => {
  it("in development prints the email and never calls the network", async () => {
    const fetchImpl = vi.fn();
    const log = vi.fn();
    await sendEmail(message, {
      env: env({ NODE_ENV: "development" }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain("123456");
    expect(String(log.mock.calls[0]?.[0])).toContain("not sent");
  });

  it("posts the email to Resend with the key and the sender", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    await sendEmail(message, {
      env: env({
        NODE_ENV: "production",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "ACE <noreply@example.com>",
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "ACE <noreply@example.com>",
      to: ["zz.client@example.com"],
      subject: "Your ACE sign-in code",
      text: "Your code is 123456",
      html: "<p>Your code is 123456</p>",
    });
  });

  it("throws on a refusal without putting the address in the error", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 422 }));
    const error = await sendEmail(message, {
      env: env({
        NODE_ENV: "production",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "ACE <noreply@example.com>",
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("The email could not be sent (Resend answered 422).");
    expect((error as Error).message).not.toContain("example.com");
  });
});
