import type { Logger } from "pino";
import { createAiProvider, type AiProvider } from "./ai/index.js";
import { loadNicheConfig, parseEnv, type Env, type NicheConfig } from "./config/index.js";
import { createPrismaClient, type PrismaClient } from "./database/prisma.js";
import {
  PrismaDiscoveredPostRepository,
  type DiscoveredPostRepository,
} from "./database/repositories/discovered-post-repository.js";
import {
  PrismaEngagementRepository,
  type EngagementRepository,
} from "./database/repositories/engagement-repository.js";
import {
  PrismaPublishedPostRepository,
  type PublishedPostRepository,
} from "./database/repositories/published-post-repository.js";
import { PrismaRunRepository, type RunRepository } from "./database/repositories/run-repository.js";
import { createLogger } from "./utils/logger.js";
import { createXClient, type XClient } from "./x/index.js";

export interface Repositories {
  runs: RunRepository;
  posts: DiscoveredPostRepository;
  engagements: EngagementRepository;
  published: PublishedPostRepository;
}

/** Everything a job needs, built once per process. */
export interface App {
  env: Env;
  niche: NicheConfig;
  logger: Logger;
  /** null when X credentials are not configured (dry-run only). */
  x: XClient | null;
  /** null when AI_PROVIDER=none. */
  ai: AiProvider | null;
  repos: Repositories;
  close(): Promise<void>;
}

export async function createApp(): Promise<App> {
  const env = parseEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    name: env.BOT_NAME,
    pretty: env.NODE_ENV === "development",
  });
  const niche = await loadNicheConfig(env.NICHE_CONFIG_PATH);
  const prisma: PrismaClient = createPrismaClient(env.DATABASE_URL);

  return {
    env,
    niche,
    logger,
    x: createXClient(env, logger),
    ai: createAiProvider(env),
    repos: {
      runs: new PrismaRunRepository(prisma),
      posts: new PrismaDiscoveredPostRepository(prisma),
      engagements: new PrismaEngagementRepository(prisma),
      published: new PrismaPublishedPostRepository(prisma),
    },
    close: () => prisma.$disconnect(),
  };
}
