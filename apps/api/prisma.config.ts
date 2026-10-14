import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';
import { fileURLToPath } from 'node:url';

loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
