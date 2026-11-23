export const DEMO_CONFIG = Object.freeze({ apiKey: 'demo', projectId: 'demo', appId: 'demo' });
const fields = ['apiKey', 'authDomain', 'projectId', 'appId', 'appCheckSiteKey', 'cloudModel'];
export function configuration(raw = {}) {
  const configured = fields.every(key => typeof raw[key] === 'string' && raw[key].trim());
  return { demo: !configured, partial: !configured && fields.some(key => Boolean(raw[key])), firebase: configured ? Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'].map(key => [key, raw[key] || ''])) : { ...DEMO_CONFIG }, siteKey: configured ? raw.appCheckSiteKey : '', cloudModel: configured ? raw.cloudModel : '' };
}
export const config = configuration(globalThis.CASETWIN_CONFIG);
