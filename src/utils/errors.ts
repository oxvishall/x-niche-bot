/** Human-readable error text, including codes and causes that `message` alone can hide. */
export function formatError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length) {
    const inner = error.errors.map(formatError).join("; ");
    return error.message ? `${error.message}: ${inner}` : inner;
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const text = error.message || error.name;
    return typeof code === "string" && !text.includes(code) ? `${text} (${code})` : text;
  }
  return String(error);
}
