const DEFAULT_RETURN_TO = "/";
const UNSAFE_CHARACTERS = /[\\\u0000-\u001f\u007f]/;

export function safeReturnTo(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return DEFAULT_RETURN_TO;
  if (!raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_RETURN_TO;
  if (UNSAFE_CHARACTERS.test(raw)) return DEFAULT_RETURN_TO;
  return raw;
}
