import type { NicheConfig } from "../config/niche.schema.js";
import { validateContent } from "../content/validate.js";
import type { PublishedPostRepository } from "../database/repositories/published-post-repository.js";

export const POST_REVIEW_USAGE = `Usage: npm run review -- posts <command>

  list                         Post drafts waiting for review
  approve <id> [edited text]   Approve a draft; the next publishing run posts it
  reject <id>                  Reject a draft`;

/** Executes one post-review command and returns the lines to print. */
export async function runPostReviewCommand(
  args: string[],
  config: NicheConfig,
  published: PublishedPostRepository,
): Promise<string[]> {
  const [command, id, ...rest] = args;
  const niche = config.niche.name;

  switch (command) {
    case "list": {
      const items = await published.list(niche, ["PENDING_REVIEW"], 20);
      if (!items.length) return ["No post drafts waiting for review."];
      return items.flatMap((p) => [`[${p.id}] topic: ${p.topic ?? "-"}`, `  ${p.content}`, ""]);
    }

    case "approve": {
      const item = id ? await published.get(id) : null;
      if (!item || item.status !== "PENDING_REVIEW") return [`No pending post draft with id ${id ?? "(missing)"}.`];
      const edited = rest.join(" ").trim();
      if (edited) {
        const check = validateContent(edited, {
          maxLength: 280,
          allowHashtags: true,
          allowLinks: true,
          allowedMentions: [],
          bannedPhrases: [],
          excludedKeywords: [],
          similarityThreshold: 1.1,
          recentTexts: [],
        });
        if (check.status !== "ok") {
          return [`Edited text was not approved: ${check.status === "invalid" ? check.issues.join(", ") : "empty"}`];
        }
        await published.approve(item.id, check.text, check.hash);
      } else {
        await published.approve(item.id);
      }
      return [`Approved ${item.id}. The next publishing run will post it.`];
    }

    case "reject": {
      const item = id ? await published.get(id) : null;
      if (!item || !["PENDING_REVIEW", "APPROVED"].includes(item.status)) {
        return [`No pending or approved post with id ${id ?? "(missing)"}.`];
      }
      await published.reject(item.id);
      return [`Rejected ${item.id}.`];
    }

    default:
      return [POST_REVIEW_USAGE];
  }
}
