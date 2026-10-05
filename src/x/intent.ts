/** Public URL of a post. */
export function postUrl(postId: string, username?: string | null): string {
  return `https://x.com/${username ?? "i/web"}/status/${postId}`;
}

/**
 * X web-intent link that opens X's own composer with the reply prefilled.
 * A human reviews and clicks Post; nothing is automated.
 */
export function replyIntentUrl(inReplyToPostId: string, text: string): string {
  const params = new URLSearchParams({ in_reply_to: inReplyToPostId, text });
  return `https://x.com/intent/post?${params.toString()}`;
}

/** Extracts a post ID from a status URL, or returns the input if it is already an ID. */
export function parsePostId(value: string): string | null {
  const trimmed = value.trim();
  // Prefer the ID after "/status/" so a numeric username in the URL isn't mistaken for it.
  const match = trimmed.match(/\/status(?:es)?\/(\d{5,25})(?:[/?#]|$)/) ?? trimmed.match(/^(\d{5,25})$/);
  return match?.[1] ?? null;
}
