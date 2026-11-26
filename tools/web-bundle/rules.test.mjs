// Security-rule tests against the local emulator (firebase emulators:start --project demo-training-log,
// then FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node tools/seed-emulator.js). Run: node --test rules.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInAnonymously, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, collection, writeBatch, serverTimestamp, deleteField, query, where } from 'firebase/firestore';

const OWNER = 'dev-owner-key-0000000000000000000000';
const TRAINER = 'dev-trainer-key-00000000000000000000';
let n = 0;
async function client(key) {
  const app = initializeApp({ projectId: 'demo-training-log', apiKey: 'demo-key' }, `c${n++}`);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const { user } = await signInAnonymously(auth);
  let session = 'none';
  if (key) { try { await setDoc(doc(db, 'sessions', user.uid), { key }); session = 'ok'; } catch (e) { session = e.code; } }
  return { db, uid: user.uid, session, close: () => deleteApp(app) };
}
const ok = (p) => p.then(() => true, (e) => { if (e.code !== 'permission-denied') throw e; return false; });
const thumb = 'data:image/jpeg;base64,AAAA';

test('stranger with no or wrong key gets nothing', async () => {
  const none = await client();
  assert.equal(await ok(getDoc(doc(none.db, 'meta', 'public'))), false);
  assert.equal(await ok(getDocs(collection(none.db, 'days'))), false);
  const wrong = await client('guessed-key-guessed-key-guessed-key!');
  assert.equal(wrong.session, 'permission-denied');
  assert.equal(await ok(getDocs(collection(wrong.db, 'photos'))), false);
  assert.equal(await ok(setDoc(doc(wrong.db, 'sessions', 'someone-else'), { key: OWNER })), false, 'cannot write another uid session');
  await none.close(); await wrong.close();
});

test('trainer reads data but no secrets, cannot change data', async () => {
  const t = await client(TRAINER);
  assert.equal(t.session, 'ok');
  assert.equal(await ok(getDoc(doc(t.db, 'meta', 'public'))), true);
  assert.equal(await ok(getDocs(query(collection(t.db, 'days'), where('date', '>=', '2020-01-01')))), true);
  assert.equal(await ok(getDocs(collection(t.db, 'activities'))), true);
  assert.equal(await ok(getDoc(doc(t.db, 'photoFiles', 's1'))), true);
  for (const id of ['connections', 'status', 'withingsApp', 'garminLogin']) assert.equal(await ok(getDoc(doc(t.db, 'private', id))), false, `private/${id}`);
  assert.equal(await ok(getDoc(doc(t.db, 'config', 'keys'))), false, 'keys');
  assert.equal(await ok(updateDoc(doc(t.db, 'config', 'keys'), { trainerKey: 'x'.repeat(40) })), false, 'rotate');
  assert.equal(await ok(setDoc(doc(t.db, 'days', '2026-01-01'), { date: '2026-01-01', macros: { kcal: 1, protein: 1, carbs: 1, fat: 1, source: 'manual' } })), false, 'macros');
  assert.equal(await ok(setDoc(doc(t.db, 'private', 'connections'), { garmin: deleteField() }, { merge: true })), false, 'connections');
  await t.close();
});

async function upload(db, id, uploadedBy) {
  const b = writeBatch(db);
  b.set(doc(db, 'photoFiles', id), { data: thumb });
  b.set(doc(db, 'photos', id), { date: '2026-11-20', kind: 'progress', pose: 'side', note: '', thumb, uploadedBy, createdAt: serverTimestamp() });
  return b.commit();
}
async function remove(db, id) {
  const b = writeBatch(db); b.delete(doc(db, 'photoFiles', id)); b.delete(doc(db, 'photos', id)); return b.commit();
}

test('trainer photos: upload as trainer, edit own only', async () => {
  const t = await client(TRAINER);
  assert.equal(await ok(upload(t.db, 'tp1', 'owner')), false, 'cannot pretend to be owner');
  assert.equal(await ok(upload(t.db, 'tp1', 'trainer')), true);
  assert.equal(await ok(setDoc(doc(t.db, 'photos', 'tp2'), { date: '2026-11-20', kind: 'meal', pose: null, note: '', thumb, uploadedBy: 'trainer', createdAt: serverTimestamp() })), false, 'photo without its file');
  assert.equal(await ok(updateDoc(doc(t.db, 'photos', 'tp1'), { date: '2026-11-21', note: 'moved' })), true);
  assert.equal(await ok(updateDoc(doc(t.db, 'photos', 'tp1'), { uploadedBy: 'owner' })), false, 'cannot change uploader');
  assert.equal(await ok(updateDoc(doc(t.db, 'photos', 'tp1'), { date: 'tomorrow' })), false, 'bad date');
  assert.equal(await ok(updateDoc(doc(t.db, 'photos', 's1'), { note: 'x' })), false, "owner's photo");
  assert.equal(await ok(remove(t.db, 's1')), false, "delete owner's photo");
  assert.equal(await ok(remove(t.db, 'tp1')), true);
  await t.close();
});

test('owner: manages settings, still cannot read tokens or password', async () => {
  const o = await client(OWNER);
  assert.equal(o.session, 'ok');
  assert.equal((await getDoc(doc(o.db, 'config', 'keys'))).data().trainerKey, TRAINER);
  assert.equal(await ok(getDoc(doc(o.db, 'private', 'status'))), true);
  assert.equal(await ok(setDoc(doc(o.db, 'private', 'garminLogin'), { email: 'a@b.c', password: 'pw' })), true);
  assert.equal(await ok(getDoc(doc(o.db, 'private', 'garminLogin'))), false, 'password write-only');
  assert.equal(await ok(getDoc(doc(o.db, 'private', 'connections'))), false, 'tokens write-only');
  assert.equal(await ok(setDoc(doc(o.db, 'private', 'withingsApp'), { clientId: 'id', clientSecret: 'sec' })), true);
  assert.equal(await ok(getDoc(doc(o.db, 'private', 'withingsApp'))), true);
  assert.equal(await ok(setDoc(doc(o.db, 'days', '2026-11-26'), { date: '2026-11-26', macros: { kcal: 2000, protein: 150, carbs: 200, fat: 66, source: 'manual' } }, { merge: true })), true, 'manual macros');
  assert.equal(await ok(setDoc(doc(o.db, 'days', '2026-11-26'), { steps: 99999 }, { merge: true })), false, 'cannot fake steps');
  assert.equal(await ok(setDoc(doc(o.db, 'days', '2026-11-26'), { macros: { kcal: -5, protein: 1, carbs: 1, fat: 1, source: 'manual' } }, { merge: true })), false, 'bad macros');
  assert.equal(await ok(updateDoc(doc(o.db, 'days', '2026-11-26'), { macros: deleteField() })), true, 'clear macros');
  assert.equal(await ok(updateDoc(doc(o.db, 'config', 'keys'), { ownerKey: 'y'.repeat(40) })), false, 'owner key fixed');
  assert.equal(await ok(updateDoc(doc(o.db, 'photos', 's3'), { note: 'owner can edit trainer photo' })), true);
  await o.close();
});

test('replacing the trainer link cuts off a trainer already signed in', async () => {
  const t = await client(TRAINER);
  assert.equal(await ok(getDoc(doc(t.db, 'meta', 'public'))), true);
  const o = await client(OWNER);
  const next = 'new-trainer-key-new-trainer-key-new-trainer';
  await updateDoc(doc(o.db, 'config', 'keys'), { trainerKey: next });
  assert.equal(await ok(getDoc(doc(t.db, 'meta', 'public'))), false, 'old link dead');
  const t2 = await client(next);
  assert.equal(await ok(getDoc(doc(t2.db, 'meta', 'public'))), true, 'new link works');
  await updateDoc(doc(o.db, 'config', 'keys'), { trainerKey: TRAINER });
  await Promise.all([t.close(), t2.close(), o.close()]);
});

const FRIEND = 'dev-friend-key-000000000000000000000';
test('friends link: read-only, meal photos only', async () => {
  const f = await client(FRIEND);
  assert.equal(f.session, 'ok');
  assert.equal(await ok(getDoc(doc(f.db, 'meta', 'public'))), true);
  assert.equal(await ok(getDocs(query(collection(f.db, 'days'), where('date', '>=', '2020-01-01')))), true);
  assert.equal(await ok(getDocs(collection(f.db, 'activities'))), true);
  assert.equal(await ok(getDocs(query(collection(f.db, 'photos'), where('kind', '==', 'meal')))), true, 'meal photos');
  assert.equal(await ok(getDocs(collection(f.db, 'photos'))), false, 'all photos incl. progress');
  assert.equal(await ok(getDocs(query(collection(f.db, 'photos'), where('kind', '==', 'progress')))), false, 'progress photos');
  assert.equal(await ok(getDoc(doc(f.db, 'photos', 's1'))), false, 'one progress photo');
  assert.equal(await ok(getDoc(doc(f.db, 'photoFiles', 's1'))), false, 'progress photo file');
  assert.equal(await ok(getDoc(doc(f.db, 'photoFiles', 's5'))), true, 'meal photo file');
  for (const id of ['connections', 'status', 'withingsApp']) assert.equal(await ok(getDoc(doc(f.db, 'private', id))), false, `private/${id}`);
  assert.equal(await ok(getDoc(doc(f.db, 'config', 'keys'))), false, 'keys');
  const b = writeBatch(f.db); b.set(doc(f.db, 'photoFiles', 'fp1'), { data: thumb });
  b.set(doc(f.db, 'photos', 'fp1'), { date: '2026-11-20', kind: 'meal', pose: null, note: '', thumb, uploadedBy: 'trainer', createdAt: serverTimestamp() });
  assert.equal(await ok(b.commit()), false, 'friend upload');
  assert.equal(await ok(updateDoc(doc(f.db, 'photos', 's5'), { note: 'x' })), false, 'friend edit');
  assert.equal(await ok(setDoc(doc(f.db, 'days', '2026-01-02'), { date: '2026-01-02', macros: { kcal: 1, protein: 1, carbs: 1, fat: 1, source: 'manual' } })), false, 'friend macros');
  await f.close();
});

test('owner can switch the friends link off and on', async () => {
  const o = await client(OWNER);
  const f = await client(FRIEND);
  await updateDoc(doc(o.db, 'config', 'keys'), { viewerKey: deleteField() });
  assert.equal(await ok(getDoc(doc(f.db, 'meta', 'public'))), false, 'off: friend cut off');
  const t = await client(TRAINER);
  assert.equal(await ok(getDoc(doc(t.db, 'meta', 'public'))), true, 'trainer unaffected');
  assert.equal(await ok(updateDoc(doc(o.db, 'config', 'keys'), { viewerKey: 'short' })), false, 'weak key refused');
  await updateDoc(doc(o.db, 'config', 'keys'), { viewerKey: FRIEND });
  assert.equal(await ok(getDoc(doc(f.db, 'meta', 'public'))), true, 'on again');
  await Promise.all([o.close(), f.close(), t.close()]);
});
