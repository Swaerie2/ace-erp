// Control characters are exactly what is being removed here.
const CONTROL = /[\u0000-\u001f\u007f]/g;
const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * The visitor's address from the host's forwarding headers: the first address in `x-forwarded-for`, else
 * `x-real-ip`. Anything that does not look like an address is ignored. Used only for the rate limiter
 * (hashed) and as proof on an acceptance.
 */
export function clientIpFromHeaders(get: (name: string) => string | null): string | null {
  const forwarded = get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (IP_SHAPE.test(forwarded)) return forwarded;
  const real = get("x-real-ip")?.trim() ?? "";
  return IP_SHAPE.test(real) ? real : null;
}

/** A browser string made safe to store: no control characters, at most 300 characters, null when empty. */
export function cleanUserAgent(value: string | null): string | null {
  const cleaned = (value ?? "").replace(CONTROL, "").trim().slice(0, 300);
  return cleaned === "" ? null : cleaned;
}
