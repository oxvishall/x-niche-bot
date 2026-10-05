import type { NicheConfig } from "../config/niche.schema.js";
import { validateContent } from "../content/validate.js";
import type { EngagementRepository, EngagementView } from "../database/repositories/engagement-repository.js";
import { parsePostId, postUrl, replyIntentUrl } from "../x/intent.js";

export const REVIEW_USAGE = `Usage: npm run review -- <command>

  list [limit]                 Drafts waiting for review
  approve <id> [edited text]   Approve a draft, optionally replacing its text
  reject <id>                  Reject a draft
  links                        Approved intent replies with X links to post them yourself
  done <id> [reply url or id]  Mark an approved intent reply as posted
  posts <command>              Review original post drafts (see: npm run review -- posts)`;

function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function describe(item: EngagementView): string[] {
  return [
    `[${item.id}] ${item.post.origin === "MENTION" ? "mention" : `score ${item.post.relevanceScore?.toFixed(2) ?? "-"}`}  @${item.post.authorUsername ?? item.targetAuthorId}  (${item.delivery === "API" ? "posted by the bot" : "you post it"})`,
    `  post:  ${excerpt(item.post.text)}`,
    `  url:   ${postUrl(item.targetExternalId, item.post.authorUsername)}`,
    `  reply: ${item.content ?? "(none)"}`,
  ];
}

/** Executes one review command and returns the lines to print. */
export async function runReviewCommand(
  args: string[],
  config: NicheConfig,
  engagements: EngagementRepository,
): Promise<string[]> {
  const [command, id, ...rest] = args;
  const niche = config.niche.name;

  switch (command) {
    case "list": {
      const limit = Number(id ?? 20) || 20;
      const items = await engagements.list(niche, ["PENDING_REVIEW"], limit);
      if (!items.length) return ["No drafts waiting for review."];
      return items.flatMap((item) => [...describe(item), ""]);
    }

    case "approve": {
      const item = id ? await engagements.get(id) : null;
      if (!item || item.status !== "PENDING_REVIEW") return [`No pending draft with id ${id ?? "(missing)"}.`];

      const edited = rest.join(" ").trim();
      if (edited) {
        const check = validateContent(edited, {
          maxLength: 280,
          allowHashtags: true,
          allowLinks: true,
          allowedMentions: item.post.authorUsername ? [item.post.authorUsername.toLowerCase()] : [],
          bannedPhrases: [],
          excludedKeywords: [],
          similarityThreshold: 1.1,
          recentTexts: [],
        });
        if (check.status !== "ok") {
          return [`Edited text was not approved: ${check.status === "invalid" ? check.issues.join(", ") : "empty"}`];
        }
        await engagements.approve(item.id, check.text, check.hash);
      } else {
        await engagements.approve(item.id);
      }

      const text = edited || item.content!;
      return item.delivery === "INTENT"
        ? [`Approved ${item.id}. Post it yourself:`, `  ${replyIntentUrl(item.targetExternalId, text)}`, `Then run: npm run review -- done ${item.id}`]
        : [`Approved ${item.id}. It will be posted by the next engagement run.`];
    }

    case "reject": {
      const item = id ? await engagements.get(id) : null;
      if (!item || !["PENDING_REVIEW", "APPROVED"].includes(item.status)) {
        return [`No pending or approved reply with id ${id ?? "(missing)"}.`];
      }
      await engagements.reject(item.id);
      return [`Rejected ${item.id}.`];
    }

    case "links": {
      const items = await engagements.list(niche, ["APPROVED"], 50, "INTENT");
      if (!items.length) return ["No approved replies waiting for you to post."];
      return items.flatMap((item) => [
        ...describe(item),
        `  post it: ${replyIntentUrl(item.targetExternalId, item.content!)}`,
        "",
      ]);
    }

    case "done": {
      const item = id ? await engagements.get(id) : null;
      if (!item || item.status !== "APPROVED" || item.delivery !== "INTENT") {
        return [`No approved intent reply with id ${id ?? "(missing)"}.`];
      }
      const replyId = rest[0] ? parsePostId(rest[0]) : null;
      if (rest[0] && !replyId) return [`Could not read a post ID from "${rest[0]}".`];
      await engagements.markPosted(item.id, replyId);
      return [`Marked ${item.id} as posted.`];
    }

    default:
      return [REVIEW_USAGE];
  }
}
