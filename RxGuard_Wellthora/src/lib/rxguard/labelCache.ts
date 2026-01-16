import 'server-only';

import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { buildLabelSnapshot } from './evidence';
import { chooseDeterministicRecord, detectAmbiguity, fetchLabelCandidates } from './openfda';
import {
  LabelResolutionResult,
  LabelSnapshot,
  OpenFdaLabelRecord,
} from './types';
import { bytesUtf8, normalizeForKey } from './utils';

const COLLECTION_LABELS = 'rxguard_labels';
const COLLECTION_INDEX = 'rxguard_drug_index';

// Hot in-memory caches (per server instance). Speeds up repeated calls during demos/benchmarks.
const memDrugToDocId = new Map<string, string>();
const memDocIdToSnapshot = new Map<string, LabelSnapshot>();

// Firestore has a 1MiB per doc limit. To be safe, keep a margin.
const MAX_FIRESTORE_DOC_BYTES = 900_000;

function makeLabelDocId(snapshot: LabelSnapshot): string {
  return `${snapshot.setId}_${snapshot.effectiveTime}`;
}

async function readEvidenceTextFromStorage(storagePath: string): Promise<string> {
  const file = adminBucket.file(storagePath);
  const [buf] = await file.download();
  return buf.toString('utf8');
}

async function writeEvidenceTextToStorage(storagePath: string, text: string): Promise<void> {
  const file = adminBucket.file(storagePath);
  await file.save(text, {
    contentType: 'text/plain; charset=utf-8',
    resumable: false,
    metadata: { cacheControl: 'public,max-age=31536000' },
  });
}

async function getSnapshotByDocId(docId: string): Promise<LabelSnapshot | null> {
  const mem = memDocIdToSnapshot.get(docId);
  if (mem) return mem;

  const snap = await adminDb.collection(COLLECTION_LABELS).doc(docId).get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  const evidenceText: string = data.evidenceText
    ? data.evidenceText
    : data.evidenceStoragePath
      ? await readEvidenceTextFromStorage(data.evidenceStoragePath)
      : '';

  if (!evidenceText) return null;

  const snapshot = {
    setId: data.setId,
    effectiveTime: data.effectiveTime,
    evidenceHash: data.evidenceHash,
    evidenceText,
    sections: data.sections,
    brandNames: data.brandNames ?? [],
    genericNames: data.genericNames ?? [],
    activeIngredientsList: data.activeIngredientsList ?? [],
  } as LabelSnapshot;

  memDocIdToSnapshot.set(docId, snapshot);
  return snapshot;
}

async function upsertSnapshot(snapshot: LabelSnapshot, drugKey: string): Promise<string> {
  const docId = makeLabelDocId(snapshot);
  const docRef = adminDb.collection(COLLECTION_LABELS).doc(docId);

  const evidenceBytes = bytesUtf8(snapshot.evidenceText);
  let evidenceText: string | undefined;
  let evidenceStoragePath: string | undefined;

  if (evidenceBytes <= MAX_FIRESTORE_DOC_BYTES) {
    evidenceText = snapshot.evidenceText;
  } else {
    evidenceStoragePath = `rxguard/labels/${docId}.txt`;
    await writeEvidenceTextToStorage(evidenceStoragePath, snapshot.evidenceText);
  }

  await docRef.set(
    {
      setId: snapshot.setId,
      effectiveTime: snapshot.effectiveTime,
      evidenceHash: snapshot.evidenceHash,
      ...(evidenceText ? { evidenceText } : {}),
      ...(evidenceStoragePath ? { evidenceStoragePath } : {}),
      sections: snapshot.sections,
      brandNames: snapshot.brandNames,
      genericNames: snapshot.genericNames,
      activeIngredientsList: snapshot.activeIngredientsList,
      updatedAt: new Date().toISOString(),
      source: 'openFDA',
    },
    { merge: true }
  );

  // Update mem caches
  memDrugToDocId.set(drugKey, docId);
  memDocIdToSnapshot.set(docId, snapshot);

  // Index the drug query -> label doc
  await adminDb.collection(COLLECTION_INDEX).doc(drugKey).set(
    {
      docId,
      setId: snapshot.setId,
      effectiveTime: snapshot.effectiveTime,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  memDrugToDocId.set(drugKey, docId);
  memDocIdToSnapshot.set(docId, snapshot);

  return docId;
}

function toOption(r: OpenFdaLabelRecord) {
  return {
    brandNames: r.openfda?.brand_name ?? [],
    genericNames: r.openfda?.generic_name ?? [],
    activeIngredients: r.active_ingredient ?? [],
    setId: r.set_id,
    effectiveTime: r.effective_time,
  };
}

/**
 * Resolve a drug query into a pinned label snapshot.
 *
 * Safety behavior:
 * - If candidates map to different active ingredient sets, returns `ambiguous` to force clarification.
 * - Otherwise, pins the latest effective_time record deterministically.
 */
export async function resolveDrugToPinnedLabel(
  drugQuery: string
): Promise<LabelResolutionResult> {
  const normalizedDrugQuery = normalizeForKey(drugQuery);

  // 0) In-memory cache (fastest)
  const memDocId = memDrugToDocId.get(normalizedDrugQuery);
  if (memDocId) {
    const cached = await getSnapshotByDocId(memDocId);
    if (cached) {
      return {
        kind: 'ok',
        drugQuery,
        normalizedDrugQuery,
        snapshot: cached,
      };
    }
  }

  // 1) Fast path: check cached index
  const idxDoc = await adminDb.collection(COLLECTION_INDEX).doc(normalizedDrugQuery).get();
  const cachedDocId = idxDoc.exists ? (idxDoc.data() as any)?.docId : undefined;
  if (cachedDocId) {
    const cached = await getSnapshotByDocId(cachedDocId);
    if (cached) {
      memDrugToDocId.set(normalizedDrugQuery, cachedDocId);
      return {
        kind: 'ok',
        drugQuery,
        normalizedDrugQuery,
        snapshot: cached,
      };
    }
  }

  // 2) Fetch from openFDA
  const { records } = await fetchLabelCandidates(drugQuery, { limit: 8 });
  if (!records.length) {
    return {
      kind: 'not_found',
      drugQuery,
      normalizedDrugQuery,
      reason: 'No openFDA label records matched this medication name.',
    };
  }

  // 3) Ambiguity check (multi-formulation brands)
  const amb = detectAmbiguity(records);
  if (amb.ambiguous) {
    return {
      kind: 'ambiguous',
      drugQuery,
      normalizedDrugQuery,
      reason:
        'Multiple label records matched this name with different active ingredients / formulations.',
      options: amb.options.slice(0, 5).map((o) => toOption(o.record)),
    };
  }

  // 4) Choose deterministic record and pin
  const record = chooseDeterministicRecord(records);
  if (!record) {
    return {
      kind: 'not_found',
      drugQuery,
      normalizedDrugQuery,
      reason: 'No suitable openFDA label record could be selected.',
    };
  }

  const snapshot = buildLabelSnapshot(record);
  const docId = await upsertSnapshot(snapshot, normalizedDrugQuery);
  // reload to guarantee evidenceText present (storage fallback)
  const saved = (await getSnapshotByDocId(docId)) ?? snapshot;

  return {
    kind: 'ok',
    drugQuery,
    normalizedDrugQuery,
    snapshot: saved,
  };
}
