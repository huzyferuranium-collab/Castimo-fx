import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, testFirestoreConnection } from '../config/firebase';
import firebaseConfigJson from '../../firebase-applet-config.json';
import { UserProfile, UserRole } from '../types';

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  error: string | null;
  lastErrorCode: string | null;
  diagnosticAdvice: string | null;
  apiNeedsActivation: boolean;
  activationUrl: string | null;
  isDemoUser: boolean;
  isDirectSession: boolean;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string, role?: UserRole) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInDirectSession: (email: string, name?: string, role?: UserRole) => void;
  signOutUser: () => Promise<void>;
  switchRole: (role: UserRole) => Promise<void>;
  demoLogin: (role: UserRole) => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'castimofx_auth_session';

const DEMO_CLIENT: UserProfile = {
  uid: 'demo-client-castimo-001',
  email: 'trader@castimofx.com',
  displayName: 'David Vance (Client)',
  role: 'client',
  createdAt: new Date().toISOString(),
};

function createMockUser(uid: string, email: string, displayName: string): User {
  return {
    uid,
    email,
    displayName,
    emailVerified: true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: 'mock-token',
    tenantId: null,
    delete: async () => {},
    getIdToken: async () => 'mock-token',
    getIdTokenResult: async () => ({} as any),
    reload: async () => {},
    toJSON: () => ({}),
    phoneNumber: null,
    photoURL: null,
    providerId: 'castimofx-session',
  } as unknown as User;
}

function getDiagnosticAdvice(code?: string, message?: string): string {
  const c = code || '';
  const m = message || '';

  if (c.includes('identity-toolkit') || m.includes('identity-toolkit') || m.includes('identitytoolkit.googleapis.com')) {
    return 'The Google Cloud Identity Toolkit API is currently disabled on project 700597994216. Enable it in Google Cloud Console or continue using Direct Session mode.';
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
  const [apiNeedsActivation, setApiNeedsActivation] = useState<boolean>(false);
  const [activationUrl, setActivationUrl] = useState<string | null>(null);
  const [isDemoUser, setIsDemoUser] = useState<boolean>(false);
  const [isDirectSession, setIsDirectSession] = useState<boolean>(false);

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

    // Check localStorage for active session
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.uid && parsed?.email) {
          console.log('🔄 [Auth Session] Restoring persistent local session for:', parsed.email, `(Role: ${parsed.role})`);
          // Stored sessions are local only and can never carry admin rights.
          setUserProfile({ ...parsed, role: 'client' });
          setUser(createMockUser(parsed.uid, parsed.email, parsed.displayName || 'Trader'));
          setIsDirectSession(true);
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      console.warn('Session parse notice:', e);
    }

    // Listen to Firebase Auth state
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log('🔔 [Firebase Auth] onAuthStateChanged fired. CurrentUser:', currentUser ? currentUser.uid : 'null');
      if (currentUser) {
        setIsDemoUser(false);
        setIsDirectSession(false);
        setUser(currentUser);
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
              role: (data.role as UserRole) || 'client',
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
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!stored) {
          setUser(null);
          setUserProfile(null);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInDirectSession = (email: string, name?: string, role: UserRole = 'client') => {
    const cleanEmail = email.trim();
    const cleanName = name || cleanEmail.split('@')[0];
    const uid = 'usr-' + Math.abs(cleanEmail.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)).toString(36);

    const profile: UserProfile = {
      uid,
      email: cleanEmail,
      displayName: cleanName,
      role: 'client',
      createdAt: new Date().toISOString(),
    };

    console.log('⚡ [Direct Session] Authenticating in client session mode:', profile);

    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(profile));
    } catch (e) {
      console.warn('Storage notice:', e);
    }

    setUserProfile(profile);
    setUser(createMockUser(uid, cleanEmail, cleanName));
    setIsDirectSession(true);
    setIsDemoUser(false);
    setError(null);
    setLastErrorCode(null);
    setDiagnosticAdvice(null);
  };

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

      if (
        message.includes('identity-toolkit-api') ||
        message.includes('identitytoolkit.googleapis.com') ||
        code.includes('identity-toolkit')
      ) {
        setApiNeedsActivation(true);
        setActivationUrl(
          'https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=700597994216'
        );
      }

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

      if (
        message.includes('identity-toolkit-api') ||
        message.includes('identitytoolkit.googleapis.com') ||
        code.includes('identity-toolkit')
      ) {
        setApiNeedsActivation(true);
        setActivationUrl(
          'https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=700597994216'
        );
      }

      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setError(null);
    setLastErrorCode(null);
    setDiagnosticAdvice(null);
    setLoading(true);

    console.group('🌐 [Firebase Auth] Attempting signInWithPopup (Google Provider)');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const gUser = result.user;
      console.log('✅ [Firebase Auth] Google Sign-in Succeeded!', {
        uid: gUser.uid,
        email: gUser.email,
        displayName: gUser.displayName,
      });

      const userDocRef = doc(db, 'users', gUser.uid);
      const snap = await getDoc(userDocRef);

      let role: UserRole = 'client';
      if (snap.exists()) {
        role = (snap.data().role as UserRole) || 'client';
      } else {
        await setDoc(userDocRef, {
          uid: gUser.uid,
          email: gUser.email,
          displayName: gUser.displayName || 'Google Trader',
          role: 'client',
          createdAt: new Date().toISOString(),
          serverCreatedAt: serverTimestamp(),
        });
      }

      setUserProfile({
        uid: gUser.uid,
        email: gUser.email || '',
        displayName: gUser.displayName || 'Google Trader',
        role,
        createdAt: new Date().toISOString(),
        photoURL: gUser.photoURL || undefined,
      });
      console.groupEnd();
    } catch (err: any) {
      const code = err?.code || 'unknown';
      const message = err?.message || String(err);
      const advice = getDiagnosticAdvice(code, message);

      console.error('❌ [Firebase Auth] Google Sign-in Failed with error:', {
        code,
        message,
        diagnosticAdvice: advice,
      });
      console.groupEnd();

      setLastErrorCode(code);
      setError(message);
      setDiagnosticAdvice(advice);

      if (
        message.includes('identity-toolkit-api') ||
        message.includes('identitytoolkit.googleapis.com') ||
        code.includes('identity-toolkit')
      ) {
        setApiNeedsActivation(true);
        setActivationUrl(
          'https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=700597994216'
        );
      }

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
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      setIsDemoUser(false);
      setIsDirectSession(false);
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

  const demoLogin = (_role?: UserRole) => {
    setIsDemoUser(true);
    setIsDirectSession(false);
    const demoProfile = DEMO_CLIENT; // demo sessions are always plain clients
    console.log('🎮 [Demo Mode] Activating demo session:', demoProfile);
    setUserProfile(demoProfile);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(demoProfile));
    } catch (e) {
      // Ignored
    }
    setUser(createMockUser(demoProfile.uid, demoProfile.email, demoProfile.displayName));
    setError(null);
    setLastErrorCode(null);
    setDiagnosticAdvice(null);
  };

  const clearError = () => {
    setError(null);
    setLastErrorCode(null);
    setDiagnosticAdvice(null);
    setApiNeedsActivation(false);
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
        apiNeedsActivation,
        activationUrl,
        isDemoUser,
        isDirectSession,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signInDirectSession,
        signOutUser,
        switchRole,
        demoLogin,
        clearError,
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
