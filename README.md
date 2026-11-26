# Training log

A private dashboard for you and your personal trainer, on Firebase's free plan.

- **Garmin**: steps and workouts
- **Withings**: weight, body fat, sleep
- **MyFitnessPal**: not working yet (see below); macros can be typed in by hand
- **Photos**: progress and meal photos; you and your trainer can both upload and set the date

Live at **https://yufei-training-log.web.app**. Design rules are in `DESIGN.md`.

## How it fits together (no server, no bill)

| Part | Where | Cost |
|------|-------|------|
| Web page | `public/` on Firebase Hosting | free |
| Data and photos | Firestore (Singapore) | free tier: 1 GB, 50k reads/day |
| Access control | `firestore.rules` | free |
| Sync | `.github/workflows/sync.yml` + `sync/` on GitHub Actions | free (private repos get 2,000 min/month; this uses about 100) |

- **Access is by secret link.** `config/keys` in Firestore holds an owner key and a trainer key. The page
  signs each browser in anonymously and proves the key from its link; `firestore.rules` checks that key
  on every read and write. Replacing the trainer key in Settings cuts off the old link at once.
- **The trainer** can see everything except Settings, and can upload photos and edit or delete their own.
- **Secrets the browser never reads back:** source tokens (`private/connections`) and the Garmin password
  (`private/garminLogin`, deleted by the next sync after one sign-in attempt).
- **The sync** runs at 06:20, 14:20 and 22:20 Singapore time and re-reads the last 4 days. It reaches
  Firestore through Google's keyless GitHub login, restricted to the `main` branch of
  `pangyufei-stack/training-log`, as a service account that can only use the database. No key is stored in GitHub.
  To run it on demand: GitHub → Actions → Sync → Run workflow (set days to 90 the first time).
- **Photos** are compressed in the browser to at most 1600 px (under ~700 KB) plus a small preview,
  and stored in Firestore. Roughly 1,500 photos fit in the free 1 GB.

## Connecting the sources (owner link → Settings)

- **Garmin:** enter email and password; the next sync signs in. If Garmin refuses sign-ins from GitHub's
  servers, run `node scripts/garmin-login.js` on your own computer (after `cd sync && npm install`) and
  paste what it prints. Accounts with two-step verification are not supported.
- **Withings:** create a free app at https://developer.withings.com with callback URL
  `https://yufei-training-log.web.app/`, then enter its client ID and secret in Settings and press Connect.
- **MyFitnessPal:** MyFitnessPal moved its diary pages to an internal API that needs a login token even
  for public diaries. `sync/src/sources/mfp.js` reads the old page format and does not work. Fixing it
  needs one sample of the new API's response.

## Working on it

Preview with sample data (needs Java for the database emulator):

```bash
firebase emulators:start --project demo-training-log
```

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node tools/seed-emulator.js
```

Then open http://127.0.0.1:5000/#k=dev-owner-key-0000000000000000000000 (trainer:
`#k=dev-trainer-key-00000000000000000000`).

Tests: `cd sync && npm test` (parsers), and with the emulator running and seeded,
`cd tools/web-bundle && node --test rules.test.mjs` (security rules).

Deploy the page and rules: `firebase deploy --only firestore,hosting`. The Firebase library in
`public/vendor/firebase.js` is built by `cd tools/web-bundle && npm install && npm run build`.
