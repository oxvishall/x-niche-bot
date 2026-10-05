import type { App } from "../app.js";
import { runDiscovery } from "../services/discovery-service.js";
import { runEngagement } from "../services/engagement-service.js";
import { runPublishing } from "../services/publishing-service.js";
import type { JobDefinition } from "./scheduler.js";

const MINUTE = 60_000;

/** The worker's recurring jobs, built from env intervals. */
export function buildJobs(app: App): JobDefinition[] {
  return [
    {
      // Engagement runs right after discovery so drafts use fresh posts.
      name: "discover-and-engage",
      intervalMs: app.env.DISCOVERY_INTERVAL_MINUTES * MINUTE,
      run: async () => {
        // A discovery failure (e.g. X outage) shouldn't block drafting from stored posts.
        const discovery = await runDiscovery(app).catch((error: unknown) => {
          app.logger.error({ err: error }, "Discovery failed");
          return { error: error instanceof Error ? error.message : String(error) };
        });
        return { discovery, engagement: await runEngagement(app) };
      },
    },
    {
      name: "publish",
      intervalMs: app.env.PUBLISH_INTERVAL_MINUTES * MINUTE,
      run: () => runPublishing(app),
    },
  ];
}
