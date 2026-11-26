export interface CookieAttributes {
  maxAgeSeconds: number;
  secure: boolean;
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header === undefined) return cookies;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    if (!cookies.has(name)) cookies.set(name, part.slice(at + 1).trim());
  }
  return cookies;
}

export function serializeCookie(name: string, value: string, attributes: CookieAttributes): string {
  const parts = [
    name + "=" + value,
    "Path=/",
    "Max-Age=" + String(attributes.maxAgeSeconds),
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (attributes.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", { maxAgeSeconds: 0, secure });
}
