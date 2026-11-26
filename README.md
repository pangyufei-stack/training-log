# Training log

A private dashboard for you and your personal trainer, hosted on Firebase.

- **Garmin**: steps and workouts
- **Withings**: weight, body fat, sleep
- **MyFitnessPal**: calories and macros
- **Photos**: progress and meal photos; you and your trainer can both upload and set the date
- Synced automatically three times a day; the trainer opens one secret link, no account needed

Design rules are in `DESIGN.md`.

## Try it locally first (sample data, no accounts)

```bash
cd functions && npm install && cd ..
```

```bash
node scripts/dev-server.js
```

Open <http://localhost:5174/#k=dev-owner>. The trainer's link is under Settings.

## How it fits together

| Part | Where | What it does |
|------|-------|--------------|
| Web page | `public/` on Firebase Hosting | Dashboard, no build step |
| API | `functions/` `api` function | Checks the secret link, serves data and photos |
| Daily sync | `functions/` `scheduledSync` | 06:20, 14:20, 22:20 in your timezone; re-reads the last 4 days |
| Data | Firestore | One record per day, workouts, photo tags, login tokens |
| Photos | Cloud Storage | Never public; only served through the API |

Firestore and Storage rules deny all direct access. Everything goes through the API.

## Deploy

Needs a Firebase project on the **Blaze (pay-as-you-go) plan**: Cloud Functions, the scheduler and
secrets are not available on the free plan. Usage here is small, but set a budget alert in Google Cloud.

1. In the Firebase console: create a project, upgrade to Blaze, create a **Firestore** database and
   turn on **Storage**.
2. Install the tools and sign in:
   ```bash
   npm install -g firebase-tools
   ```
   ```bash
   firebase login
   ```
3. Point this folder at your project: copy `.firebaserc.example` to `.firebaserc` and put in your project id.
4. Copy `functions/.env.example` to `functions/.env` and set your timezone, a display name and
   `PUBLIC_URL` (`https://YOUR-PROJECT-ID.web.app`).
5. Create your owner key. Generate one, then store it as a secret (paste it when asked):
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
   ```bash
   firebase functions:secrets:set OWNER_KEY
   ```
6. Withings: register a free app at <https://developer.withings.com> with the callback URL
   `https://YOUR-PROJECT-ID.web.app/api/withings/callback`, then store its two values.
   (To deploy before you have them, enter `unset` for both.)
   ```bash
   firebase functions:secrets:set WITHINGS_CLIENT_ID
   ```
   ```bash
   firebase functions:secrets:set WITHINGS_CLIENT_SECRET
   ```
7. Deploy:
   ```bash
   firebase deploy
   ```
8. Open `https://YOUR-PROJECT-ID.web.app/#k=YOUR-OWNER-KEY`, go to **Settings**, connect the three
   sources, press **Re-read 90 days**, then copy the **Trainer link** and send it.

Functions run in `asia-southeast1` (Singapore), next to the Firestore database. To change region, edit `REGION` in `functions/index.js` and the
rewrite in `firebase.json` together.

## Things to know

- **The links are the passwords.** Anyone holding the trainer link sees your data and photos and can
  add photos. Replace it from Settings if it leaks. Your owner link also lets you change settings; keep it to yourself.
- **Garmin** has no official API for individuals. This uses the unofficial `garmin-connect` library.
  It does not support accounts with two-step verification, and Garmin sometimes refuses sign-ins
  from cloud servers; in that case run `node scripts/garmin-login.js` on your own computer and paste
  the result into Settings. Your Garmin password is never stored.
- **MyFitnessPal** has no public API. The app reads the "printable diary" web page. Simplest is to
  set the diary to Public in MyFitnessPal and give only the username; otherwise paste a session cookie,
  which expires now and then. When the scan fails the dashboard shows a banner and you can type the
  day's macros in by hand (open the day in Daily log). **This scan has not been tested against the
  live MyFitnessPal site**; expect to adjust `functions/src/sources/mfp.js` on first run.
- **Withings** uses the official API and is the dependable one.
- Photos are shrunk in the browser to at most 1800 px before upload.

## Tests

```bash
cd functions && npm test
```
