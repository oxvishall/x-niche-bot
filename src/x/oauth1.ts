import { createHmac, randomBytes } from "node:crypto";

export interface OAuth1Credentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface OAuth1SignOptions {
  method: string;
  /** Full URL including any query string. */
  url: string;
  credentials: OAuth1Credentials;
  /** Form-encoded body params only. JSON bodies are not part of the signature. */
  bodyParams?: Record<string, string>;
  nonce?: string;
  timestamp?: number;
}

/** RFC 3986 percent-encoding, as OAuth 1.0a requires. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Builds the `Authorization: OAuth ...` header value for a request. */
export function buildOAuth1Header(options: OAuth1SignOptions): string {
  const { credentials } = options;
  const url = new URL(options.url);

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: options.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(options.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };

  const params: [string, string][] = [
    ...[...url.searchParams.entries()],
    ...Object.entries(options.bodyParams ?? {}),
    ...Object.entries(oauthParams),
  ].map(([k, v]) => [percentEncode(k), percentEncode(v)]);
  params.sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : 1) : ak < bk ? -1 : 1));

  const paramString = params.map(([k, v]) => `${k}=${v}`).join("&");
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const baseString = [
    options.method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join("&");
  const signingKey = `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessTokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const header = Object.entries({ ...oauthParams, oauth_signature: signature })
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ");
  return `OAuth ${header}`;
}
