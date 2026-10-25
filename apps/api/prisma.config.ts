import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Generating the client needs no database, so DATABASE_URL is only required by
// commands that connect (migrate, db execute, studio). Those fail with a clear
// message if it is missing. Hosted servers give migrations their own address
// (MIGRATE_DATABASE_URL), because Prisma's migration engine spells TLS options
// differently from the app's database driver.
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  ...(url ? { datasource: { url } } : {}),
});
