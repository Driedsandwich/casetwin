import { config } from './config.js';
let appPromise;
export async function firebaseApp() {
  if (!appPromise) appPromise = (async () => {
    const { initializeApp } = await import('firebase/app');
    const app = initializeApp(config.firebase);
    if (!config.demo) {
      const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
      // Dev-only. A registered debug value may live in the ignored local config; none is stored in this repository.
      const debug = globalThis.CASETWIN_APP_CHECK_DEBUG;
      if (import.meta.env.DEV && (debug === true || (typeof debug === 'string' && /^[0-9a-f-]{36}$/i.test(debug)))) globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = debug;
      initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(config.siteKey), isTokenAutoRefreshEnabled: true });
    }
    return app;
  })();
  return appPromise;
}
export async function signIn() {
  if (config.demo) return { demo: true };
  const { getAuth, GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  const result = await signInWithPopup(getAuth(await firebaseApp()), new GoogleAuthProvider());
  return { demo: false, signedIn: Boolean(result.user) };
}
export async function signOut() {
  if (config.demo) return;
  const { getAuth, signOut: endSession } = await import('firebase/auth');
  await endSession(getAuth(await firebaseApp()));
}
export async function saveBundle(bundle) {
  const { validateShareBundle } = await import('./sharing.js');
  const safe = validateShareBundle(bundle);
  if (config.demo) return { simulated: true, id: 'demo' };
  const app = await firebaseApp();
  const { getAuth } = await import('firebase/auth');
  const user = getAuth(app).currentUser;
  if (!user) throw new Error('SIGN_IN_REQUIRED');
  // Firestore Lite avoids persistent caches and listeners. Only share bundles reach this function.
  const { getFirestore, doc, setDoc, serverTimestamp } = await import('firebase/firestore/lite');
  const latest = doc(getFirestore(app), 'users', user.uid, 'bundles', 'latest');
  await setDoc(latest, { ...safe, ownerId: user.uid, createdAt: serverTimestamp() });
  return { simulated: false, id: latest.id };
}
