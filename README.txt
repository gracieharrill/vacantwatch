VacantWatch friendly map zoom guidance

Replacement file:
src/app/page.tsx

Install:
1. Extract this ZIP into C:\Users\graceharrill\vacantwatch
2. Replace the existing src\app\page.tsx
3. Run:

Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
npm run test:smoke
npm run dev

Test:
1. Select King County.
2. Zoom out until the parcel safety limit is exceeded.
3. Confirm friendly zoom guidance appears instead of a red error.
4. Zoom in and confirm parcels load automatically.

Commit:
git add .
git commit -m "Add friendly map zoom guidance"
git push --set-upstream origin feature/map-zoom-guidance
