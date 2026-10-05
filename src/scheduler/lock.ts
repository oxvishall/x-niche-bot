import pg from "pg";

/**
 * Session-level Postgres advisory lock held on a dedicated connection, so only
 * one worker per niche runs jobs at a time (prevents double replies/posts when
 * two instances are started by mistake).
 */
export class WorkerLock {
  private client: pg.Client | null = null;

  constructor(
    private readonly databaseUrl: string,
    private readonly key: string,
  ) {}

  /** Returns true if this process now holds the lock. */
  async tryAcquire(): Promise<boolean> {
    const client = new pg.Client({ connectionString: this.databaseUrl });
    await client.connect();
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [this.key],
    );
    if (rows[0]?.locked) {
      this.client = client;
      return true;
    }
    await client.end();
    return false;
  }

  async release(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.query("SELECT pg_advisory_unlock(hashtext($1))", [this.key]);
    } finally {
      await this.client.end();
      this.client = null;
    }
  }
}
