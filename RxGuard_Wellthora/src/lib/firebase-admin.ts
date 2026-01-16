import 'server-only';

/**
 * Firebase Admin SDK bootstrap for server-side code (Next.js server actions / route handlers).
 *
 * Why this exists:
 * - RxGuard needs to cache *public* FDA label snapshots and benchmark artifacts.
 * - You do NOT want to open Firestore rules for writes just to support caching.
 * - Admin SDK runs only on the server and bypasses Firestore rules safely.
 *
 * Local dev options:
 * 1) `gcloud auth application-default login`
 *    (then applicationDefault() will work)
 * 2) Or set GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 */

import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

function getCredential() {
  // Optional: supply the service account JSON via an env var (useful in CI).
  // Example: FIREBASE_SERVICE_ACCOUNT_KEY_JSON='{"project_id":...}'
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON;
  if (json) {
    try {
      return cert(JSON.parse(json));
    } catch (e) {
      console.warn(
        '[firebase-admin] FIREBASE_SERVICE_ACCOUNT_KEY_JSON is set but could not be parsed. Falling back to applicationDefault().' 
      );
    }
  }

  return applicationDefault();
}

// IMPORTANT:
// - On Firebase App Hosting / Cloud Run, applicationDefault() works out-of-the-box.
// - storageBucket can be omitted if your default bucket is configured in Firebase.
/**
 * Storage bucket name.
 *
 * Typical default bucket names:
 * - <project-id>.appspot.com
 * - (newer projects may use) <project-id>.firebasestorage.app
 */
const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET ||
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
  (() => {
    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env.FIREBASE_PROJECT_ID;
    return projectId ? `${projectId}.appspot.com` : undefined;
  })();

export const adminApp =
  getApps().length > 0
    ? getApps()[0]!
    : initializeApp({
        credential: getCredential(),
        ...(storageBucket ? { storageBucket } : {}),
      });

export const adminDb = getFirestore(adminApp);

// If storageBucket is not specified above, this will use the default bucket
// configured for the Firebase project.
if (!storageBucket) {
  // This should rarely happen (Cloud Run provides project id). But it helps
  // local debugging if you forgot to set FIREBASE_STORAGE_BUCKET.
  throw new Error(
    'Firebase Storage bucket name is not configured. Set FIREBASE_STORAGE_BUCKET (e.g. <project-id>.appspot.com).' 
  );
}

export const adminBucket = getStorage(adminApp).bucket(storageBucket);
