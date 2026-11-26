// Only the Firebase pieces the dashboard uses, bundled into one file.
export { initializeApp } from 'firebase/app';
export { getAuth, signInAnonymously, connectAuthEmulator } from 'firebase/auth';
export {
  getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where,
  orderBy, writeBatch, serverTimestamp, deleteField,
} from 'firebase/firestore';
