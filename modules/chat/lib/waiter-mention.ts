const FENCED_CODE_BLOCK = /```[\s\S]*?```/g;
const INLINE_CODE_SPAN = /`[^`]*`/g;
const WAITER_MENTION = /(^|[^\w])@waiter(?=$|[^\w])/i;

export function parseMentionsWaiter(text: string): boolean {
  const withoutFences = text.replaceAll(FENCED_CODE_BLOCK, " ");
  const withoutCode = withoutFences.replaceAll(INLINE_CODE_SPAN, " ");
  return WAITER_MENTION.test(withoutCode);
}
