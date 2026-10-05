export class XApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "XApiError";
  }

  /** 4xx errors other than 429 won't succeed on retry. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export class XRateLimitError extends XApiError {
  constructor(
    endpoint: string,
    readonly resetAt?: Date,
  ) {
    super(
      `X API rate limit reached for ${endpoint}${resetAt ? `, resets at ${resetAt.toISOString()}` : ""}`,
      429,
      endpoint,
    );
    this.name = "XRateLimitError";
  }
}
