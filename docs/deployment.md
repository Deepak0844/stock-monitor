# Deployment

Single server, Docker Compose. The API serves the web app, so there is no separate web container.

## What runs

| Service | Role |
|---|---|
| `postgres` | PostgreSQL 17. Data lives in the `pgdata` volume. Not published to the host. |
| `migrate` | Runs once per deploy: applies migrations and sets the password of the restricted `stock_app` login role. |
| `api` | Fastify API plus the built web app, on `127.0.0.1:3000`. Runs as a non-root user. |
| `worker` | pg-boss job worker. Supplier checks arrive in later modules. |

The API and worker connect as `stock_app`, which can add and read audit events but cannot change or delete them. Only the `migrate` step uses the database owner.

## First run

```bash
cp .env.example .env          # then fill in the three secrets, using the commands inside
docker compose up -d --build
docker compose run --rm api node --import tsx apps/api/src/cli/create-owner.ts
```

Open http://127.0.0.1:3000 and sign in. For plain-http local use set `COOKIE_SECURE=false` in `.env`. Use `true` behind HTTPS.

## Updating

`git pull`, then `docker compose up -d --build`. Migrations run automatically before the API and worker start.

## Server hardening (the checklist from the design discussion)

Saved supplier sessions are decrypted in memory while a check runs, so anyone who controls the server could use them. Encryption protects the database and backups, not a compromised server.

- SSH with keys only. Password login off, root login off.
- Firewall: allow only 22, 80 and 443. Nothing else is published.
- Automatic security updates for the operating system. Update Docker images regularly.
- HTTPS through a reverse proxy (Caddy or nginx) in front of `127.0.0.1:3000`. Set `COOKIE_SECURE=true`.
- Set `TRUST_PROXY=true` **only** if the proxy overwrites `X-Forwarded-For` with the real client address. Otherwise anyone can fake their address and dodge the sign-in rate limit. Leave it `false` with no proxy.
- `.env` readable only by the deploy user (`chmod 600 .env`). Never commit it.
- Back up `APP_ENCRYPTION_KEY` separately, for example in a password manager. If it is lost, saved sessions and the Shopify token cannot be read. They can be recreated by reconnecting.
- Encrypted, off-server database backups: nightly `pg_dump` to storage such as S3 or Backblaze, and a restore test. **Not automated yet.** It is a follow-up task.
- Check the pilot supplier's terms of service on automated access before the first real check.

## Known limits

- The sign-in rate limiter is in memory. A restart resets it.
- The image has no Playwright browsers. The supplier modules add their own image, plus the locked-down noVNC login.
- Drizzle migrations only go forward. To undo one in development, recreate the database.
- Estimated running cost for the pilot: a small VPS at about 10 to 20 USD a month, plus backup storage.
