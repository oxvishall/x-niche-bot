import "dotenv/config";
import { createApp } from "../app.js";
import { REVIEW_USAGE, runReviewCommand } from "../engagement/review.js";

/** Human review of drafted replies, e.g. `npm run review -- list`. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log(REVIEW_USAGE);
    return;
  }

  const app = await createApp();
  try {
    const lines = await runReviewCommand(args, app.niche, app.repos.engagements);
    console.log(lines.join("\n"));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
