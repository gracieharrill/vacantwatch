VacantWatch King County visible-map bounds

Replace these project files:

src/lib/property/king-county.ts
src/lib/property/providers/king-county.ts
src/lib/property/provider.ts
src/app/api/properties/route.ts
scripts/smoke-test.mjs

What changes:

- King County now reports mapBounds: true.
- King County starts at zoom 14.
- The ArcGIS parcel layer is queried with the visible WGS84 envelope.
- Visible parcel PINs are intersected with the tax/vacancy candidates before pagination.
- Bound results are cached for five minutes.
- Areas containing more than 20,000 parcels return HTTP 400 with a Zoom in message.
- Smoke tests cover a known Beacon Avenue parcel and wide-map rejection.

Commands:

Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
npm run test:smoke

Expected final line:

All 11 smoke tests passed.

Commit and push:

git add .
git commit -m "Add King County map bounds search"
git push --set-upstream origin feature/king-map-bounds
