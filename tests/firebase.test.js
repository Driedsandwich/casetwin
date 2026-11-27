import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { demoBundle } from '../src/sharing.js';

test('Firestore saves replace the signed-in owner’s latest document', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected network request'));
  const writes = [];
  globalThis.CASETWIN_CONFIG = Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'appId', 'appCheckSiteKey', 'cloudModel'].map(key => [key, 'test']));
  globalThis.testSetDoc = (...args) => { writes.push(args); };
  const firebaseURL = new URL('../src/firebase.js', import.meta.url).href;
  const modules = {
    'firebase/app': 'export const initializeApp = () => "test-app";',
    'firebase/app-check': 'export class ReCaptchaEnterpriseProvider {} export const initializeAppCheck = () => {};',
    'firebase/auth': 'export const getAuth = () => ({ currentUser: { uid: "signed-in-user" } });',
    'firebase/firestore/lite': `
      export const getFirestore = app => app;
      export const doc = (db, ...segments) => ({ db, path: segments.join('/'), id: segments.at(-1) });
      export const setDoc = (...args) => globalThis.testSetDoc(...args);
      export const serverTimestamp = () => 'SERVER_TIMESTAMP';
    `
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === firebaseURL && Object.hasOwn(modules, specifier)) {
        return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (url === firebaseURL) return { ...loaded, source: `import.meta.env = { DEV: false };\n${loaded.source}` };
      return loaded;
    }
  });
  t.after(() => {
    hooks.deregister();
    delete globalThis.CASETWIN_CONFIG;
    delete globalThis.testSetDoc;
  });

  const { saveBundle } = await import('../src/firebase.js');
  const first = demoBundle();
  const second = { ...first, report: { ...first.report, text: 'Replacement draft' } };
  for (const bundle of [first, second]) {
    assert.deepEqual(await saveBundle(bundle), { simulated: false, id: 'latest' });
  }
  assert.deepEqual(writes, [first, second].map(bundle => [
    { db: 'test-app', path: 'users/signed-in-user/bundles/latest', id: 'latest' },
    { ...bundle, ownerId: 'signed-in-user', createdAt: 'SERVER_TIMESTAMP' }
  ]));
  assert.equal(fetch.mock.callCount(), 0);
});
