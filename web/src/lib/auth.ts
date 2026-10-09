export const COOKIE = "mogo_session";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const sessionToken = (password: string) =>
  hmacHex(password, "mogo-session");

export function checkPassword(input: string): boolean {
  const pw = process.env.APP_PASSWORD;
  return !!pw && safeEqual(input, pw);
}

/** Fails closed in production: without APP_PASSWORD nobody gets in. */
export async function isAuthorized(
  cookieValue: string | undefined,
): Promise<boolean> {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return process.env.NODE_ENV !== "production";
  return !!cookieValue && safeEqual(cookieValue, await sessionToken(pw));
}
