import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Generating the client needs no database, so DATABASE_URL is only required by
// commands that connect (migrate, db execute, studio). Those fail with a clear
// message if it is missing.
const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  ...(url ? { datasource: { url } } : {}),
});
