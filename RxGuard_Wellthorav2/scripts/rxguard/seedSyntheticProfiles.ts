/**
 * Seed a small library of synthetic profiles into Firestore.
 *
 * Why:
 * - For your benchmark + demo, you can point to versioned, reproducible profile sets
 *   stored in Firebase (instead of hardcoding).
 *
 * Run locally:
 *   1) Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   2) Set FIREBASE_STORAGE_BUCKET=<project-id>.appspot.com (and OPENFDA_API_KEY optional)
 *   3) npx tsx scripts/rxguard/seedSyntheticProfiles.ts
 */

import { adminDb } from '../../src/lib/firebase-admin';

const COLLECTION = 'rxguard_synthetic_profiles';

const PROFILES: Array<{
  id: string;
  displayName: string;
  tags: string[];
  profile: {
    age?: number;
    sex?: 'M' | 'F' | 'Other' | 'Unknown';
    pregnancy?: 'no' | 'trying' | 'pregnant_t1' | 'pregnant_t2' | 'pregnant_t3' | 'unknown';
    conditions?: string[];
    currentMeds?: string[];
    allergies?: string[];
  };
}> = [
  {
    id: 'healthy_adult',
    displayName: 'Healthy Adult',
    tags: ['control'],
    profile: { age: 25, sex: 'Unknown', pregnancy: 'no', conditions: [], currentMeds: [] },
  },
  {
    id: 'ulcers_warfarin',
    displayName: 'Stomach Ulcers + Warfarin',
    tags: ['bleeding', 'anticoagulant'],
    profile: { conditions: ['stomach ulcers'], currentMeds: ['warfarin'] },
  },
  {
    id: 'ckd_stage3',
    displayName: 'Chronic Kidney Disease',
    tags: ['renal'],
    profile: { conditions: ['chronic kidney disease (CKD)'] },
  },
  {
    id: 'pregnant_t3',
    displayName: 'Pregnant (3rd trimester)',
    tags: ['pregnancy'],
    profile: { pregnancy: 'pregnant_t3' },
  },
];

async function main() {
  const batch = adminDb.batch();
  for (const p of PROFILES) {
    const ref = adminDb.collection(COLLECTION).doc(p.id);
    batch.set(ref, {
      displayName: p.displayName,
      tags: p.tags,
      profile: p.profile,
      updatedAt: new Date().toISOString(),
    });
  }
  await batch.commit();
  console.log(`Seeded ${PROFILES.length} synthetic profiles into ${COLLECTION}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
