import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { CreatedPost } from "../types/index.js";
import type { CreatePostInput, CreateReplyInput, XClient } from "./client.js";

export const DRY_RUN_ID_PREFIX = "dry-run-";

/**
 * Passes reads through to the real client and turns every write into a log
 * line, so DRY_RUN can never publish anything.
 */
export class DryRunXClient implements XClient {
  constructor(
    private readonly inner: XClient,
    private readonly logger: Logger,
  ) {}

  searchPosts: XClient["searchPosts"] = (params) => this.inner.searchPosts(params);
  getPost: XClient["getPost"] = (id) => this.inner.getPost(id);
  getUser: XClient["getUser"] = (id) => this.inner.getUser(id);
  getAuthenticatedUser: XClient["getAuthenticatedUser"] = () => this.inner.getAuthenticatedUser();

  async createPost(input: CreatePostInput): Promise<CreatedPost> {
    this.logger.info({ text: input.text }, "[dry run] would publish post");
    return { id: `${DRY_RUN_ID_PREFIX}${randomUUID()}`, text: input.text };
  }

  async createReply(input: CreateReplyInput): Promise<CreatedPost> {
    this.logger.info(
      { inReplyTo: input.inReplyToPostId, text: input.text },
      "[dry run] would publish reply",
    );
    return { id: `${DRY_RUN_ID_PREFIX}${randomUUID()}`, text: input.text };
  }
}

/** A poster for dry runs when no X credentials are configured at all. */
export function dryRunPoster(logger: Logger): Pick<XClient, "createPost"> {
  return {
    async createPost(input: CreatePostInput): Promise<CreatedPost> {
      logger.info({ text: input.text }, "[dry run] would publish post");
      return { id: `${DRY_RUN_ID_PREFIX}${randomUUID()}`, text: input.text };
    },
  };
}
