import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendEmailVerification,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, testFirestoreConnection } from '../config/firebase';
import firebaseConfigJson from '../../firebase-applet-config.json';
import { UserProfile, UserRole } from '../types';
import { attachPendingReferral } from '../services/referralApi';

interface AuthContextType {
  isAdmin: boolean;
  isClient: boolean;
  isEmailVerified: boolean;
  sendVerificationEmail: () => Promise<{ success: boolean; error?: string }>;
  refreshEmailVerified: () => Promise<boolean>;
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  error: string | null;
  lastErrorCode: string | null;
  diagnosticAdvice: string | null;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string, role?: UserRole) => Promise<void>;
  signOutUser: () => Promise<void>;
  switchRole: (role: UserRole) => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Older versions kept a browser-only "quick" session here. It is no longer used and is cleared on start.
const OLD_SESSION_KEY = 'castimofx_auth_session';

function getDiagnosticAdvice(code?: string, message?: string): string {
  const c = code || '';
  const m = message || '';

  if (c.includes('identity-toolkit') || m.includes('identity-toolkit') || m.includes('identitytoolkit.googleapis.com')) {
    return 'Sign-in is not switched on for this Firebase project yet. Please contact support.';
  }
  if (c === 'auth/operation-not-allowed') {
    return 'Email/Password sign-in method is not enabled in Firebase Console. Go to Firebase Console > Build > Authentication > Sign-in method to turn on Email/Password.';
  }
  if (c === 'auth/user-not-found' || c === 'auth/invalid-credential') {
    return 'No registered account found with these credentials. If you are a new user, switch to the "Register Client" tab to create your account.';
  }
  if (c === 'auth/wrong-password') {
    return 'Incorrect password entered. Please check your password or reset credentials.';
  }
  if (c === 'auth/email-already-in-use') {
    return 'An account already exists with this email address. Switch to the "Sign In" tab to log in.';
  }
  if (c === 'auth/weak-password') {
    return 'The password is too weak. Please use at least 6 characters.';
  }
  if (c === 'auth/unauthorized-domain') {
    return 'This web domain is not authorized in Firebase Console > Authentication > Settings > Authorized domains.';
  }
  if (c === 'auth/network-request-failed') {
    return 'Network request failed. Please check internet connection or browser ad-blockers.';
  }
  return 'Review the Firebase error code and console details to verify configuration.';
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);
  const [diagnosticAdvice, setDiagnosticAdvice] = useState<string | null>(null);

  // Initialize and check Firestore connection on mount
  useEffect(() => {
    console.groupCollapsed('🔥 [Firebase Applet Configuration Audit]');
    console.log('Project ID:', firebaseConfigJson.projectId);
    console.log('Auth Domain:', firebaseConfigJson.authDomain);
    console.log('App ID:', firebaseConfigJson.appId);
    console.log('API Key:', firebaseConfigJson.apiKey ? `${firebaseConfigJson.apiKey.slice(0, 10)}...[MASKED]` : 'MISSING');
    console.log('Firestore Database ID:', firebaseConfigJson.firestoreDatabaseId || '(default)');
    console.log('Storage Bucket:', firebaseConfigJson.storageBucket);
    console.log('OAuth Client ID:', firebaseConfigJson.oAuthClientId || 'None');
    console.groupEnd();

    testFirestoreConnection();

    // Remove any browser-only session left by older versions. Only real Firebase sign-ins count now.
    try {
      localStorage.removeItem(OLD_SESSION_KEY);
    } catch {
      // storage may be unavailable; nothing to clear
    }

    // Listen to Firebase Auth state
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log('🔔 [Firebase Auth] onAuthStateChanged fired. CurrentUser:', currentUser ? currentUser.uid : 'null');
      if (currentUser) {
        setUser(currentUser);
        // If this visitor arrived through a referral link, tell the server (it decides whether it counts).
        void attachPendingReferral();
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          const docSnap = await getDoc(userDocRef);

          if (docSnap.exists()) {
            const data = docSnap.data();
            console.log('📄 [Firestore] User profile document retrieved:', data);
            setUserProfile({
              uid: currentUser.uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || data.displayName || 'Trader',
              role: data.role === 'admin' ? 'admin' : 'client',
              createdAt: data.createdAt || new Date().toISOString(),
              photoURL: currentUser.photoURL || undefined,
            });
          } else {
            console.log('📄 [Firestore] User profile document does not exist yet. Creating default doc...');
            const newProfile: UserProfile = {
              uid: currentUser.uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || 'Trader',
              role: 'client',
              createdAt: new Date().toISOString(),
              photoURL: currentUser.photoURL || undefined,
            };
            await setDoc(userDocRef, {
              ...newProfile,
              serverCreatedAt: serverTimestamp(),
            });
            setUserProfile(newProfile);
          }
        } catch (err: any) {
          console.warn('⚠️ [Firestore] Profile doc read notice:', err.code, err.message);
          setUserProfile({
            uid: currentUser.uid,
            email: currentUser.email || '',
            displayName: currentUser.displayName || 'Trader',
            role: 'client',
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        setUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithEmail = async (email: string, pass: string) => {
    setError(null);
    setLastErrorCode(null);
    setDiagnosticAdvice(null);
    setLoading(true);

    console.group('🔐 [Firebase Auth] Attempting signInWithEmailAndPassword');
    console.log('Email:', email);
    console.log('Timestamp:', new Date().toISOString());

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, pass);
      console.log('✅ [Firebase Auth] Sign-in Succeeded!', {
        uid: userCredential.user.uid,
        email: userCredential.user.email,
        emailVerified: userCredential.user.emailVerified,
      });
      console.groupEnd();
    } catch (err: any) {
      const code = err?.code || 'unknown';
      const message = err?.message || String(err);
      const advice = getDiagnosticAdvice(code, message);

      console.error('❌ [Firebase Auth] Sign-in Failed with error:', {
        code,
        message,
        customData: err?.customData,
        stack: err?.stack,
        diagnosticAdvice: advice,
      });
      console.groupEnd();

      setLastErrorCode(code);
      setError(message);
      setDiagnosticAdvice(advice);


      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signUpWithEmail = async (
    email: string,
    pass: string,
    displayName: string,
    role: UserRole = 'client'
  ) => {
    setError(null);
    setLastErrorCode(null);
    setDiagnosticAdvice(null);
    setLoading(true);

    console.group('📝 [Firebase Auth] Attempting createUserWithEmailAndPassword');
    console.log('Email:', email);
    console.log('DisplayName:', displayName);
    console.log('Role:', role);
    console.log('Timestamp:', new Date().toISOString());

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
      const createdUser = userCredential.user;
      console.log('✅ [Firebase Auth] User Created Successfully!', {
        uid: createdUser.uid,
        email: createdUser.email,
      });

      await updateProfile(createdUser, { displayName });
      sendEmailVerification(createdUser).catch(() => {});
      console.log('✅ [Firebase Auth] Profile display name updated to:', displayName);

      const newProfile: UserProfile = {
        uid: createdUser.uid,
        email: createdUser.email || email,
        displayName: displayName || 'Trader',
        role: 'client',
        createdAt: new Date().toISOString(),
      };

      try {
        await setDoc(doc(db, 'users', createdUser.uid), {
          ...newProfile,
          serverCreatedAt: serverTimestamp(),
        });
        console.log('✅ [Firestore] Created user document in /users/' + createdUser.uid);
      } catch (e: any) {
        console.warn('⚠️ [Firestore] User doc creation notice:', e?.code, e?.message);
      }

      setUserProfile(newProfile);
      console.groupEnd();
    } catch (err: any) {
      const code = err?.code || 'unknown';
      const message = err?.message || String(err);
      const advice = getDiagnosticAdvice(code, message);

      console.error('❌ [Firebase Auth] Registration Failed with error:', {
        code,
        message,
        customData: err?.customData,
        stack: err?.stack,
        diagnosticAdvice: advice,
      });
      console.groupEnd();

      setLastErrorCode(code);
      setError(message);
      setDiagnosticAdvice(advice);


      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signOutUser = async () => {
    setError(null);
    setLastErrorCode(null);
    setDiagnosticAdvice(null);
    console.log('🚪 [Auth] Signing out user...');
    try {
      setUser(null);
      setUserProfile(null);
      await signOut(auth);
      console.log('✅ [Auth] Signed out successfully.');
    } catch (err: any) {
      console.warn('⚠️ [Auth] Sign-out notice:', err?.code, err?.message);
    }
  };

  // View-only switch (admins previewing the client screen). Never saved anywhere,
  // and it cannot grant admin rights: reloading restores the role stored in Firebase.
  const switchRole = async (newRole: UserRole) => {
    if (!userProfile) return;
    setUserProfile({ ...userProfile, role: newRole === 'admin' ? userProfile.role : newRole });
  };

  // ---- Email verification (real: Firebase sends a link, Firebase records the result) ----
  const isRealUser = !!user;
  const isEmailVerified = isRealUser && !!user?.emailVerified;
  const [verifyTick, setVerifyTick] = useState(0);
  void verifyTick;

  const sendVerificationEmail = async () => {
    const current = auth.currentUser;
    if (!current) return { success: false, error: 'Please sign in with a real account first.' };
    try {
      await sendEmailVerification(current);
      return { success: true };
    } catch (err: any) {
      const msg =
        err?.code === 'auth/too-many-requests'
          ? 'Too many requests. Please wait a few minutes and try again.'
          : err?.message || 'Could not send the verification email.';
      return { success: false, error: msg };
    }
  };

  const refreshEmailVerified = async () => {
    const current = auth.currentUser;
    if (!current) return false;
    try {
      await current.reload();
      // A fresh sign-in token carries the new "verified" flag, which the server checks.
      await current.getIdToken(true);
      setUser(auth.currentUser);
      setVerifyTick((n) => n + 1);
    } catch {
      // ignore; keep the previous state
    }
    return !!auth.currentUser?.emailVerified;
  };

  const isAdmin = !!userProfile && userProfile.role === 'admin' && isRealUser;
  const isClient = !!userProfile && !isAdmin;

  const clearError = () => {
    setError(null);
    setLastErrorCode(null);
    setDiagnosticAdvice(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        userProfile,
        loading,
        error,
        lastErrorCode,
        diagnosticAdvice,
        signInWithEmail,
        signUpWithEmail,
        signOutUser,
        switchRole,
        clearError,
        isAdmin,
        isClient,
        isEmailVerified,
        sendVerificationEmail,
        refreshEmailVerified,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
