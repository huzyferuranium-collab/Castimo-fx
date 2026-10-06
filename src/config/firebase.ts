import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
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
export const auth = getAuth(app);

// Use initializeFirestore with experimentalAutoDetectLongPolling to ensure connectivity in sandboxed / iframe environments
export const db = initializeFirestore(
  app,
  {
    experimentalAutoDetectLongPolling: true,
  },
  firebaseConfigJson.firestoreDatabaseId || undefined
);

// Connection verification check on initial boot as per Firebase guidelines
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    const testDoc = doc(db, 'test', 'connection');
    // Wrap with a 4-second timeout to avoid unhandled offline hangs
    const checkPromise = getDocFromServer(testDoc);
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
