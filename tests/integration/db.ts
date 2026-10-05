import { inject } from "vitest";
import { createPrismaClient, type PrismaClient } from "../../src/database/prisma.js";

export const databaseUrl = () => inject("databaseUrl");

export function testPrisma(): PrismaClient {
  return createPrismaClient(databaseUrl());
}

/** Empties every table between tests. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Engagement", "PublishedPost", "DiscoveredPost", "SearchRun", "BotRun" CASCADE',
  );
}
