VacantWatch API error handling

Replace these files:

src/app/api/properties/route.ts
src/lib/property/service.ts
scripts/smoke-test.mjs

Changes:

- Unsupported provider capabilities now return HTTP 400.
- Invalid signal, numeric, money, query-length, and map-bound inputs return HTTP 400.
- Genuine provider or external-data failures remain HTTP 500.
- Expected client mistakes use concise warning logs instead of full error stacks.
- The smoke-test runner now starts Next.js directly through Node, avoiding Windows spawn EINVAL.
- The smoke tests now require exact HTTP 400 responses for unsupported features.

Commands:

Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
npm run test:smoke

Expected final line:

All 10 smoke tests passed.

Commit and push:

git add .
git commit -m "Improve API error handling"
git push --set-upstream origin feature/api-error-handling
