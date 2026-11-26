'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');

const OWNER_KEY = defineSecret('OWNER_KEY');
const WITHINGS_CLIENT_ID = defineSecret('WITHINGS_CLIENT_ID');
const WITHINGS_CLIENT_SECRET = defineSecret('WITHINGS_CLIENT_SECRET');

// Must match the region in firebase.json's hosting rewrite.
const REGION = 'us-central1';
const TZ = process.env.APP_TIMEZONE || 'UTC';

exports.api = onRequest(
  {
    region: REGION,
    secrets: [OWNER_KEY, WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET],
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 3,
    invoker: 'public',
  },
  (req, res) => require('./src/app')(req, res)
);

// Three passes a day: morning (last night's sleep and weigh-in), afternoon, and late
// evening (the day's food log, steps and workouts). Each pass re-reads the last 4 days
// so late entries and late watch syncs are picked up.
exports.scheduledSync = onSchedule(
  {
    region: REGION,
    schedule: '20 6,14,22 * * *',
    timeZone: TZ,
    secrets: [WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET],
    memory: '512MiB',
    timeoutSeconds: 300,
    retryCount: 0,
    maxInstances: 1,
  },
  async () => {
    const result = await require('./src/sync').runSync({ days: 4 });
    console.log('scheduled sync', JSON.stringify(result));
  }
);
