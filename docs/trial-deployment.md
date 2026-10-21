# Trial deployment: Vercel Hobby, Render Free, Neon Free

This is a reviewable setup, not a deployment record. No cloud resource, secret, or database was created or changed while preparing it. The Render hostname and Neon connection strings remain unknown. Keep automatic deployment and automatic notification delivery disabled for the first trial.

## Boundaries and prerequisites

- Use Node.js 24. The repository declares `24.x` for Vercel; `render.yaml` pins Render to `24.18.0`. Local checks for this setup used Node `24.18.0`.
- The Vercel project Root Directory is `apps/web`. Its `vercel.json` sets Vite, `npm run build`, `dist`, and the SPA fallback. Let Vercel detect the root npm workspace and install from the repository lockfile; enable access to files outside the Root Directory if the project settings do not already include it. No Vercel environment variable is required by the current web build.
- The Render service uses the repository root, because `npm ci` needs the root workspace lockfile. `render.yaml` specifies the Free Node service, `npm ci`, Prisma client generation, the API build and start commands, and `/api/ready` as its HTTP health check. Do not set a Render Root Directory of `apps/api`. Keep `autoDeployTrigger: off`; leave any pre-deploy command empty.
- Choose nearby Render and Neon regions where available. Free services can sleep or cold start; this trial does not promise always-on availability.

## API routing and session cookies

The web client calls same-origin `/api/...` with `credentials: 'same-origin'`. NestJS already defines routes under `/api`. Its HTTP-only session cookie has `Path=/api`, `SameSite=Lax`, and `Secure` in production. The browser must keep seeing the Vercel origin for API requests so the cookie is sent to `/api` and the API's `Set-Cookie` response is stored for that origin. A browser-visible redirect to Render or a separate API base URL would change that behavior.

The committed SPA fallback excludes `/api` and `/api/...`. Before the Render URL is known, those requests intentionally do not return `index.html` as if they were app routes. Once Render supplies its actual HTTPS hostname, add these two entries **before** the existing SPA fallback in `apps/web/vercel.json`, replacing `RENDER_HOSTNAME` with the real hostname (without a trailing slash):

```json
{
  "source": "/api",
  "destination": "https://RENDER_HOSTNAME.onrender.com/api"
},
{
  "source": "/api/:path*",
  "destination": "https://RENDER_HOSTNAME.onrender.com/api/:path*"
}
```

The final ordering is `/api`, `/api/:path*`, then `/((?!api(?:/|$)).*)` to `/index.html`. It preserves the API path and lets React Router handle direct app URLs such as `/households/.../inventory/...`. The API rewrites must come first so API requests reach Render rather than returning SPA HTML. Do not enable rewrite caching for authenticated responses. Verify the production rewrite and `Set-Cookie` behavior in a browser before considering sign-in complete.

## Environment variables and secrets

| Location                              | Variable                                                 | Value and purpose                                                                                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render runtime                        | `DATABASE_URL`                                           | Required secret. Use the intended Neon branch/database/role's **pooled** PostgreSQL URL with TLS (`sslmode=require`) for the running API. Enter only in Render's protected environment settings.                                         |
| Render runtime                        | `NOTIFICATION_AUTOMATION_ENABLED`                        | Set exactly `false` for the first deploy. The scheduler is disabled unless explicitly set to `true`.                                                                                                                                     |
| Render build/runtime                  | `NODE_VERSION`                                           | `24.18.0` in `render.yaml`.                                                                                                                                                                                                              |
| Render runtime                        | `NODE_ENV`                                               | Render supplies `production`; confirm it in service settings because it controls the cookie's `Secure` flag.                                                                                                                             |
| Render runtime                        | `PORT`                                                   | Render supplies it. The API listens on that port at `0.0.0.0`; do not hardcode a port.                                                                                                                                                   |
| Manual migration environment only     | `DATABASE_URL`                                           | Required secret. Use a **direct**, non-`-pooler` URL for the separately reviewed Prisma CLI migration. Do not use the local development `.env` or the Render runtime value for this step.                                                |
| Render runtime, later Push trial only | `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Optional for this first trial; leave unset. If Push is tested later, keep the private key only in protected service settings and continue to keep `NOTIFICATION_AUTOMATION_ENABLED=false` until scheduled sends are explicitly approved. |

The root `.env` is local development data and is ignored by Git. Never commit Neon URLs, passwords, a VAPID private key, or a populated environment file. The checked-in `.env.example` contains only disposable loopback values and must not be copied as a cloud credential.

## Manual order for a later deployment

1. Review the target branch, migration files, and these settings. Create the intended Neon Free project/branch/database. Record the target identifiers and obtain separate pooled and direct TLS connection strings privately. Confirm the direct URL's host, database, branch, and role against the Neon dashboard before any Prisma command. Keep the actual URLs out of Git, command examples, logs, and screenshots.
2. From `apps/api`, in an isolated environment with `DATABASE_URL` supplied securely as that **verified direct Neon URL**, run `npx prisma migrate status` to inspect pending migrations. Review the reported target and pending list against `apps/api/prisma/migrations`. Only after that review, run `npx prisma migrate deploy` as a **separate manual step**, then run `npx prisma migrate status` again. `prisma.config.ts` reads `DATABASE_URL` for CLI commands; do not leave the local loopback URL in scope. Do not run `migrate dev`, `db push`, or a migration from the Render build/start command. No migration command was run for this preparation task.
3. Create the Render Free web service from the reviewed `render.yaml` with the repo root available. Enter the pooled Neon `DATABASE_URL` privately. Confirm `NODE_ENV=production`, the disabled scheduler, health path, build/start commands, and automatic deploys off. Start its first deployment manually only after the target migration is verified. Capture the actual HTTPS `onrender.com` hostname and check `/api/ready` directly: 200 with `{"status":"ok"}` means a simple DB query worked; 503 indicates the query failed without revealing connection details. The app currently connects to the DB during Nest startup, so a startup connection failure may prevent the endpoint from listening at all.
4. Insert the two concrete API rewrites above using that hostname. Review the resulting `vercel.json`. Create the Vercel Hobby project with Root Directory `apps/web`, Node 24.x, and the existing build settings; deploy manually. Do not deploy the web app before its `/api` rewrite is concrete.
5. Verify the live trial: direct app deep link and reload; static manifest/service worker and offline shell; `/api/ready` through Vercel; register/sign-in, `/api/auth/me`, sign-out, and cookie `Secure`, `HttpOnly`, `SameSite`, and `Path`; one protected inventory read/write using disposable data; and that API responses are not replaced by SPA HTML or cached by the service worker/CDN. Confirm the notification scheduler remains disabled. Push registration/delivery is outside this first trial.

Render health checks treat 2xx/3xx as healthy; `/api/ready` deliberately returns 503 on a failed DB query. It does not verify the migration level or application data. A live browser and target database check remain necessary before calling this deployment ready.

## Provider references

- [Vercel Vite SPA rewrites](https://vercel.com/docs/frameworks/frontend/vite), [external rewrites](https://vercel.com/docs/routing/rewrites), [monorepo settings](https://vercel.com/docs/monorepos/monorepo-faq), [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Render monorepos](https://render.com/docs/monorepo-support), [Blueprint fields](https://render.com/docs/blueprint-spec), [health checks](https://render.com/docs/health-checks), [Node version](https://render.com/docs/node-version)
- [Prisma Neon connection guidance](https://docs.prisma.io/docs/orm/v6/overview/databases/neon), [Prisma 7 migration deployment](https://docs.prisma.io/docs/cli/v7/migrate/deploy)
