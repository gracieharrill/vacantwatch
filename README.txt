VacantWatch API smoke tests

Copy package.json and the scripts folder into the VacantWatch project.
Then run:

npm run test:smoke

The script starts a temporary Next.js development server on port 3100,
runs six API checks, and stops the server automatically.
