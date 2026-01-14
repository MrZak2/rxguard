import { EvidenceQuote, LabelSnapshot, RxGuardProfile, RiskLabel, Decision } from './types';
import { chunkTextAround, normalizeForMatch } from './utils';

export interface PolicyResult {
  decision: Decision;
  risk: RiskLabel;
  rulesTriggered: string[];
  clarifyingQuestion?: string;
  quotes: EvidenceQuote[];
}

type KeywordRule = {
  id: string;
  section: keyof LabelSnapshot['sections'] | 'CANONICAL';
  pattern: RegExp;
  reason: string;
  severity: RiskLabel;
};

// Conservative, high-signal patterns.
// NOTE: These are *label-text* patterns, not clinical logic.
const BASE_RULES: KeywordRule[] = [
  {
    id: 'BOXED_WARNING_PRESENT',
    section: 'boxedWarning',
    pattern: /\b.+/i,
    reason: 'Boxed warning section is present.',
    severity: 'HIGH',
  },
  {
    id: 'CONTRAINDICATION_MENTION',
    section: 'contraindications',
    pattern: /contraindicat(ed|ion)|\bdo not use\b|\bshould not\b|\bmust not\b/i,
    reason: 'Contraindication / strong avoidance language appears.',
    severity: 'HIGH',
  },
  {
    id: 'PREGNANCY_RISK_LANGUAGE',
    section: 'pregnancy',
    pattern: /pregnan|fetal|embryo|teratogen|ductus arteriosus/i,
    reason: 'Pregnancy-related risk language appears.',
    severity: 'HIGH',
  },
  {
    id: 'BLEEDING_RISK_LANGUAGE',
    section: 'CANONICAL',
    pattern: /bleed|hemorrhag|gastrointestinal|ulcer/i,
    reason: 'Bleeding risk language appears.',
    severity: 'MODERATE',
  },
  {
    id: 'RENAL_RISK_LANGUAGE',
    section: 'CANONICAL',
    pattern: /renal|kidney|nephro/i,
    reason: 'Kidney/renal risk language appears.',
    severity: 'MODERATE',
  },
  {
    id: 'DRUG_INTERACTION_SECTION',
    section: 'drugInteractions',
    pattern: /interact|concomitant|co-administration|avoid/i,
    reason: 'Drug interaction language appears.',
    severity: 'MODERATE',
  },
];

function getSectionText(snapshot: LabelSnapshot, key: KeywordRule['section']): string {
  if (key === 'CANONICAL') return snapshot.evidenceText;
  // Snapshot.sections keys differ in casing; map explicitly
  const s = snapshot.sections as any;
  return String(s[key] ?? '');
}

function extractQuote(text: string, pattern: RegExp): string | null {
  const m = text.match(pattern);
  if (!m || m.index == null) return null;
  // Pull a chunk around the match, then try to trim to sentence-ish boundary.
  const chunk = chunkTextAround(text, m.index, 220);
  return chunk.length ? chunk : null;
}

function bumpRisk(current: RiskLabel, next: RiskLabel): RiskLabel {
  const order: Record<RiskLabel, number> = { UNKNOWN: 0, LOW: 1, MODERATE: 2, HIGH: 3 };
  return order[next] > order[current] ? next : current;
}

function profileHasPregnancy(profile?: RxGuardProfile): boolean {
  if (!profile?.pregnancy) return false;
  return profile.pregnancy !== 'no' && profile.pregnancy !== 'unknown';
}

function profileHasCondition(profile: RxGuardProfile | undefined, keywords: string[]): boolean {
  const cond = (profile?.conditions ?? []).map((c) => normalizeForMatch(c));
  return keywords.some((k) => cond.some((c) => c.includes(normalizeForMatch(k))));
}

function profileHasMed(profile: RxGuardProfile | undefined, med: string): boolean {
  const meds = (profile?.currentMeds ?? []).map((m) => normalizeForMatch(m));
  return meds.some((m) => m.includes(normalizeForMatch(med)));
}

function anyOtherMedMentionedInInteractions(snapshot: LabelSnapshot, otherMeds: string[]): string[] {
  const interactions = normalizeForMatch(snapshot.sections.drugInteractions);
  const hits: string[] = [];
  for (const med of otherMeds) {
    const m = normalizeForMatch(med);
    if (!m) continue;
    if (interactions.includes(m)) hits.push(med);
  }
  return hits;
}

function quoteAroundSubstring(haystack: string, needle: string): string | null {
  const h = normalizeForMatch(haystack);
  const n = normalizeForMatch(needle);
  const idx = h.indexOf(n);
  if (idx < 0) return null;
  // Map normalized index back to original text approximately by searching raw too.
  const rawIdx = haystack.toLowerCase().indexOf(n);
  const around = chunkTextAround(haystack, rawIdx >= 0 ? rawIdx : 0, 220);
  return around || null;
}

/**
 * Deterministic policy evaluation.
 *
 * Goal: be safe-by-construction (conservative), *not* “perfect medical advice”.
 */
export function evaluatePolicy(args: {
  snapshot: LabelSnapshot;
  profile?: RxGuardProfile;
  otherMeds?: string[];
}): PolicyResult {
  const { snapshot, profile, otherMeds } = args;
  const rulesTriggered: string[] = [];
  const quotes: EvidenceQuote[] = [];
  let risk: RiskLabel = 'UNKNOWN';

  // --- Base label-text rules ---
  for (const rule of BASE_RULES) {
    const sectionText = getSectionText(snapshot, rule.section);
    if (!sectionText) continue;
    if (!rule.pattern.test(sectionText)) continue;

    // Pregnancy rule should only activate if profile indicates pregnancy/trying
    if (rule.id === 'PREGNANCY_RISK_LANGUAGE' && !profileHasPregnancy(profile)) continue;

    rulesTriggered.push(rule.id);
    risk = bumpRisk(risk, rule.severity);

    const quote = extractQuote(sectionText, rule.pattern);
    if (quote) {
      quotes.push({ section: rule.section === 'CANONICAL' ? 'LABEL' : rule.section.toString(), quote, reason: rule.reason });
    }
  }

  // --- Simple profile-aware upgrades ---
  // If user is on anticoagulants, bleeding language should be treated as HIGH.
  const anticoagulant = profileHasMed(profile, 'warfarin') || profileHasMed(profile, 'apixaban') || profileHasMed(profile, 'rivaroxaban') || profileHasMed(profile, 'dabigatran');
  if (anticoagulant && rulesTriggered.includes('BLEEDING_RISK_LANGUAGE')) {
    risk = bumpRisk(risk, 'HIGH');
    rulesTriggered.push('PROFILE_ANTICOAGULANT_UPGRADE');
  }

  // CKD / kidney disease upgrade renal language.
  const ckd = profileHasCondition(profile, ['ckd', 'kidney', 'renal']);
  if (ckd && rulesTriggered.includes('RENAL_RISK_LANGUAGE')) {
    risk = bumpRisk(risk, 'HIGH');
    rulesTriggered.push('PROFILE_CKD_UPGRADE');
  }

  // Check otherMeds mentioned in interaction section.
  const meds = (otherMeds ?? []).filter(Boolean);
  const interactionHits = meds.length ? anyOtherMedMentionedInInteractions(snapshot, meds) : [];
  if (interactionHits.length) {
    risk = bumpRisk(risk, 'HIGH');
    rulesTriggered.push('INTERACTION_OTHER_MED_MENTIONED');

    // Add verbatim quotes from the interaction section around each hit.
    for (const hit of interactionHits.slice(0, 3)) {
      const q = quoteAroundSubstring(snapshot.sections.drugInteractions, hit);
      if (q) {
        quotes.push({
          section: 'drugInteractions',
          quote: q,
          reason: `The interaction section mentions “${hit}”.`,
        });
      }
    }
  }

  // --- Decision mapping (conservative) ---
  let decision: Decision;
  let clarifyingQuestion: string | undefined;

  if (!snapshot?.evidenceText) {
    decision = 'CLARIFY';
    clarifyingQuestion = 'I could not retrieve the FDA label evidence for this medication. Can you provide the exact product name (and strength) from the package?';
    risk = 'UNKNOWN';
  } else if (risk === 'HIGH') {
    decision = 'BLOCK';
  } else if (risk === 'MODERATE') {
    decision = 'CAUTION';
  } else if (risk === 'LOW') {
    decision = 'INFO';
  } else {
    // UNKNOWN: be safe and ask a targeted question rather than guessing.
    decision = 'CLARIFY';
    clarifyingQuestion =
      'To check safety, I need more context (dose/formulation, your conditions, and other meds). What exact product are you using (including strength), and are you taking any other medications?';
  }

  // Ensure quotes list is not empty for BLOCK/CAUTION; otherwise provide at least 1 snippet.
  if ((decision === 'BLOCK' || decision === 'CAUTION') && quotes.length === 0) {
    quotes.push({
      section: 'LABEL',
      quote: snapshot.evidenceText.slice(0, 280) + (snapshot.evidenceText.length > 280 ? '…' : ''),
      reason: 'Label evidence snapshot (preview).',
    });
  }

  return { decision, risk, rulesTriggered, clarifyingQuestion, quotes };
}
