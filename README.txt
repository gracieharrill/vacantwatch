VacantWatch provider-driven map configuration

Replace these files in the project:

src/lib/property/provider.ts
src/lib/property/service.ts
src/lib/property/providers/king-county.ts
src/lib/property/providers/spokane-county.ts
src/app/page.tsx

Then run:

Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
npm run dev

Tests:

1. Open http://localhost:3000/api/providers
2. Confirm both providers include a "map" object.
3. Open http://localhost:3000
4. King County should open around Seattle.
5. Spokane County should open around Spokane.
6. Spokane visible-map searching should still refresh when you pan or zoom.

Commit and push:

git add .
git commit -m "Move map configuration into providers"
git push --set-upstream origin feature/provider-map-config
