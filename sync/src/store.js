'use strict';
/**
 * Firestore access for the sync job (Admin SDK: bypasses security rules).
 * Credentials come from the environment: on GitHub Actions, Google's keyless
 * GitHub login; locally, FIRESTORE_EMULATOR_HOST for the emulator.
 */
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

if (!getApps().length) initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const DELETE = FieldValue.delete();

module.exports = {
  DELETE,
  async get(c, id) {
    const snap = await db.collection(c).doc(id).get();
    return snap.exists ? snap.data() : null;
  },
  async set(c, id, data, { merge = true } = {}) {
    await db.collection(c).doc(id).set(data, { merge });
  },
  async setMany(c, entries) {
    for (let i = 0; i < entries.length; i += 400) {
      const batch = db.batch();
      for (const [id, data] of entries.slice(i, i + 400)) batch.set(db.collection(c).doc(id), data, { merge: true });
      await batch.commit();
    }
  },
  async del(c, id) {
    await db.collection(c).doc(id).delete();
  },
  async list(c, from, to) {
    let q = db.collection(c);
    if (from) q = q.where('date', '>=', from);
    if (to) q = q.where('date', '<=', to);
    const snap = await q.orderBy('date').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
};
