import "dotenv/config";
import { createApp } from "../app.js";
import { REVIEW_USAGE, runReviewCommand } from "../engagement/review.js";
import { runPostReviewCommand } from "../publishing/review.js";
import { formatError } from "../utils/errors.js";

/** Human review of drafted replies (`npm run review -- list`) and posts (`npm run review -- posts list`). */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log(REVIEW_USAGE);
    return;
  }

  const app = await createApp();
  try {
    const lines =
      args[0] === "posts"
        ? await runPostReviewCommand(args.slice(1), app.niche, app.repos.published)
        : await runReviewCommand(args, app.niche, app.repos.engagements);
    console.log(lines.join("\n"));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
