import { OpenFdaLabelRecord } from './types';
import { safeOneLine } from './utils';

const OPENFDA_BASE = 'https://api.fda.gov/drug/label.json';

export interface OpenFdaSearchResult {
  records: OpenFdaLabelRecord[];
  total: number;
}

function sanitizeTerm(term: string): string {
  return safeOneLine(term).replace(/["\\]/g, '').trim();
}

function buildSearchExpr(drugName: string): string {
  const t = sanitizeTerm(drugName);
  // Try brand_name, generic_name, and substance_name. (Not all labels fill all fields.)
  return `(
    openfda.brand_name:"${t}" OR openfda.generic_name:"${t}" OR openfda.substance_name:"${t}"
  )`.replace(/\s+/g, ' ');
}

export async function fetchLabelCandidates(
  drugName: string,
  opts?: { limit?: number; apiKey?: string }
): Promise<OpenFdaSearchResult> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 5, 25));
  const apiKey = opts?.apiKey ?? process.env.OPENFDA_API_KEY;

  const search = buildSearchExpr(drugName);
  const url = new URL(OPENFDA_BASE);
  url.searchParams.set('search', search);
  url.searchParams.set('limit', String(limit));
  if (apiKey) url.searchParams.set('api_key', apiKey);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    // openFDA is public; avoid cookies
    cache: 'no-store',
  });

  // openFDA returns 404 for “no results”
  if (res.status === 404) {
    return { records: [], total: 0 };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`openFDA error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as any;
  const records = (json?.results ?? []) as OpenFdaLabelRecord[];
  const total = Number(json?.meta?.results?.total ?? records.length);
  return { records, total };
}

function effectiveTimeToNumber(effectiveTime?: string): number {
  // effective_time is usually YYYYMMDD (string). Convert to number for sorting.
  if (!effectiveTime) return 0;
  const n = Number(effectiveTime);
  return Number.isFinite(n) ? n : 0;
}

export function chooseDeterministicRecord(
  records: OpenFdaLabelRecord[]
): OpenFdaLabelRecord | null {
  if (!records.length) return null;
  // Sort by latest effective_time, then stable tie-break by id/set_id.
  const sorted = [...records].sort((a, b) => {
    const ta = effectiveTimeToNumber(a.effective_time);
    const tb = effectiveTimeToNumber(b.effective_time);
    if (tb !== ta) return tb - ta;
    const ida = (a.id ?? a.set_id ?? '').toString();
    const idb = (b.id ?? b.set_id ?? '').toString();
    return ida.localeCompare(idb);
  });
  return sorted[0] ?? null;
}

function normalizedActiveIngredientList(r: OpenFdaLabelRecord): string[] {
  const arr = r.active_ingredient ?? [];
  return arr
    .map((s) => safeOneLine(s).toLowerCase())
    .filter(Boolean)
    .sort();
}

export function detectAmbiguity(
  records: OpenFdaLabelRecord[]
): { ambiguous: boolean; options: Array<{ record: OpenFdaLabelRecord; aiKey: string }> } {
  // If multiple top results have different active ingredient sets, treat as ambiguous.
  const options = records.map((r) => {
    const ai = normalizedActiveIngredientList(r);
    const aiKey = ai.join(' | ');
    return { record: r, aiKey };
  });

  const unique = new Set(options.map((o) => o.aiKey));
  // If there’s more than 1 distinct ingredient set among candidates, ambiguity is real.
  return { ambiguous: unique.size > 1 && records.length > 1, options };
}
