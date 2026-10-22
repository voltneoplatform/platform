/**
 * Rebuilds the test database from the migration files before the suite runs,
 * so the tests always exercise exactly what will be deployed (including the
 * hand-written checks and the append-only audit trigger).
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export default async function setup(): Promise<void> {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://voltneo:voltneo@localhost:5432/voltneo_test';
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(`Refusing to reset ${url}: the test database name must contain "test"`);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    const dir = join(__dirname, '..', 'prisma', 'migrations');
    const migrations = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const name of migrations) {
      await client.query(readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
    }
  } finally {
    await client.end();
  }
}
