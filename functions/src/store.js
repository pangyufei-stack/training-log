'use strict';
/**
 * Data access. Two implementations with the same interface:
 *  - Firestore + Cloud Storage (production)
 *  - in-memory (MEMORY_STORE=1, used by scripts/dev-server.js for local preview)
 */

const DELETE = Symbol('delete');

function isPlain(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function deepMerge(target, src) {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(src)) {
    if (v === DELETE) delete out[k];
    else if (isPlain(v)) out[k] = deepMerge(isPlain(out[k]) ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}

function memoryStore() {
  const cols = new Map();
  const files = new Map();
  const col = (name) => {
    if (!cols.has(name)) cols.set(name, new Map());
    return cols.get(name);
  };
  return {
    DELETE,
    async get(c, id) {
      const v = col(c).get(id);
      return v ? structuredClone(v) : null;
    },
    async set(c, id, data, { merge = true } = {}) {
      const prev = merge ? col(c).get(id) : null;
      col(c).set(id, deepMerge(prev, data));
    },
    async setMany(c, entries) {
      for (const [id, data] of entries) await this.set(c, id, data);
    },
    async del(c, id) {
      col(c).delete(id);
    },
    async list(c, from, to) {
      return [...col(c).entries()]
        .filter(([, v]) => (!from || v.date >= from) && (!to || v.date <= to))
        .map(([id, v]) => ({ id, ...structuredClone(v) }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    },
    async saveFile(path, buf, contentType) {
      files.set(path, { buf, contentType });
    },
    async readFile(path) {
      const f = files.get(path);
      if (!f) return null;
      const { Readable } = require('node:stream');
      return { stream: Readable.from(f.buf), contentType: f.contentType, size: f.buf.length };
    },
    async deleteFile(path) {
      files.delete(path);
    },
  };
}

function firebaseStore() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  const bucket = () => admin.storage().bucket();

  const encode = (data) => {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === DELETE) out[k] = admin.firestore.FieldValue.delete();
      else if (isPlain(v)) out[k] = encode(v);
      else out[k] = v;
    }
    return out;
  };

  return {
    DELETE,
    async get(c, id) {
      const snap = await db.collection(c).doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async set(c, id, data, { merge = true } = {}) {
      await db.collection(c).doc(id).set(encode(data), { merge });
    },
    async setMany(c, entries) {
      for (let i = 0; i < entries.length; i += 400) {
        const batch = db.batch();
        for (const [id, data] of entries.slice(i, i + 400)) {
          batch.set(db.collection(c).doc(id), encode(data), { merge: true });
        }
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
    async saveFile(path, buf, contentType) {
      await bucket().file(path).save(buf, { contentType, resumable: false, metadata: { cacheControl: 'private, max-age=31536000' } });
    },
    async readFile(path) {
      const file = bucket().file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [meta] = await file.getMetadata();
      return { stream: file.createReadStream(), contentType: meta.contentType, size: Number(meta.size) };
    },
    async deleteFile(path) {
      await bucket().file(path).delete({ ignoreNotFound: true });
    },
  };
}

module.exports = process.env.MEMORY_STORE === '1' ? memoryStore() : firebaseStore();
