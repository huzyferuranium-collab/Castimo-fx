import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import firebaseConfigJson from '../../firebase-applet-config.json';

const firebaseConfig = {
  apiKey: firebaseConfigJson.apiKey,
  authDomain: firebaseConfigJson.authDomain,
  projectId: firebaseConfigJson.projectId,
  storageBucket: firebaseConfigJson.storageBucket,
  messagingSenderId: firebaseConfigJson.messagingSenderId,
  appId: firebaseConfigJson.appId,
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Sign-in is needed on every page (even the welcome page has to know whether someone is signed in), so it loads at once.
export const auth = getAuth(app);

/**
 * The database (Firestore) is large and only signed-in people use it, so it is NOT part of the first download: the
 * welcome page never loads it. The first call downloads it (a separate file, kept in the browser's cache afterwards)
 * and sets it up; every later call gets the same instance. If the download fails (for example the connection dropped),
 * the next call tries again.
 */
export type FirestoreKit = { fs: typeof import('firebase/firestore'); db: Firestore };
let firestoreLoad: Promise<FirestoreKit> | null = null;

export function loadFirestore(): Promise<FirestoreKit> {
  if (!firestoreLoad) {
    firestoreLoad = import('firebase/firestore').then((fs) => ({
      fs,
      // experimentalAutoDetectLongPolling keeps it working in sandboxed / iframe environments
      db: fs.initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, firebaseConfigJson.firestoreDatabaseId || undefined),
    }));
    firestoreLoad.catch(() => {
      firestoreLoad = null;
    });
  }
  return firestoreLoad;
}

// Connection check, run once someone is signed in (it only writes to the browser console).
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    const { fs, db } = await loadFirestore();
    const testDoc = fs.doc(db, 'test', 'connection');
    // Wrap with a 4-second timeout to avoid unhandled offline hangs
    const checkPromise = fs.getDocFromServer(testDoc);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection check timeout')), 4000)
    );
    await Promise.race([checkPromise, timeoutPromise]);
    console.log('✅ [Firebase Firestore] Connection verified with database:', firebaseConfigJson.firestoreDatabaseId || '(default)');
    return true;
  } catch (err: any) {
    if (err?.code === 'not-found' || err?.code === 'permission-denied') {
      console.log('ℹ️ [Firebase Firestore] Connected to database with response code:', err?.code);
      return true;
    }
    // Graceful offline fallback
    console.warn('⚠️ [Firebase Firestore] Operating in offline/cached mode:', err?.message || err);
    return false;
  }
}

export default app;
