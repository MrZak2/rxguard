export type PregnancyStatus =
  | 'no'
  | 'trying'
  | 'pregnant_t1'
  | 'pregnant_t2'
  | 'pregnant_t3'
  | 'unknown';

export interface RxGuardProfile {
  age?: number;
  sex?: 'M' | 'F' | 'Other' | 'Unknown';
  pregnancy?: PregnancyStatus;
  conditions?: string[];
  currentMeds?: string[];
  allergies?: string[];
}

export interface RxGuardRequest {
  /** User's natural-language question (what they would type into the webapp) */
  question: string;

  /** The primary drug/product the question is about. Strongly recommended for safety. */
  primaryDrug?: string;

  /** Optional list of other meds/products the user says they take (polypharmacy context). */
  otherMeds?: string[];

  /** Optional structured context (for the "synthetic profile" stress-tests + real users). */
  profile?: RxGuardProfile;

  /** If true, also return the unguarded model answer for side-by-side demo */
  includeNakedModelAnswer?: boolean;

  /** Which baseline model(s) to call for naked output (demo-only). */
  nakedModel?: 'mistral-7b' | 'llama3-8b' | 'both';
}

export type RiskLabel = 'HIGH' | 'MODERATE' | 'LOW' | 'UNKNOWN';
export type Decision = 'BLOCK' | 'CAUTION' | 'CLARIFY' | 'INFO';

export interface EvidenceQuote {
  section: string;
  quote: string;
  /** Optional: why this quote matters (tag/rule) */
  reason?: string;
}

export interface ProofCard {
  source: 'openFDA';
  setId: string;
  effectiveTime: string;
  evidenceHash: string;
  quotes: EvidenceQuote[];
}

export interface RxGuardResponse {
  decision: Decision;
  risk: RiskLabel;

  /** Human-readable answer (always includes an educational disclaimer). */
  message: string;

  /** Present only when RxGuard needs more info to be safe */
  clarifyingQuestion?: string;

  proofCard?: ProofCard;

  /** Optional side-by-side baseline outputs */
  naked?: {
    mistral7b?: string;
    llama3_8b?: string;
  };

  /** For debugging and benchmark audit-trails (you can hide this in UI). */
  debug?: {
    primaryDrugResolved?: string;
    rulesTriggered: string[];
    labelDocId?: string;
  };
}

// ---- openFDA + pinned label snapshot types ----

export interface OpenFdaLabelRecord {
  id?: string;
  set_id?: string;
  effective_time?: string;
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    substance_name?: string[];
    manufacturer_name?: string[];
  };

  // Label sections (many are arrays of strings)
  active_ingredient?: string[];
  boxed_warning?: string[];
  contraindications?: string[];
  warnings?: string[];
  warnings_and_cautions?: string[];
  drug_interactions?: string[];
  pregnancy?: string[];
  lactation?: string[];
  pediatric_use?: string[];
  geriatric_use?: string[];
  do_not_use?: string[];
  ask_doctor?: string[];
}

export interface EvidenceSections {
  activeIngredients: string;
  boxedWarning: string;
  contraindications: string;
  warnings: string;
  warningsAndCautions: string;
  drugInteractions: string;
  pregnancy: string;
  lactation: string;
  pediatricUse: string;
  geriatricUse: string;
  doNotUse: string;
  askDoctor: string;
}

export interface LabelSnapshot {
  setId: string;
  effectiveTime: string;
  /** SHA-256 hash of canonical evidence text */
  evidenceHash: string;
  /** Canonical evidence text, stable order, used for substring proof checks */
  evidenceText: string;
  sections: EvidenceSections;
  // Human-friendly names for UI
  brandNames: string[];
  genericNames: string[];
  activeIngredientsList: string[];
}

export interface LabelResolutionResult {
  kind: 'ok' | 'not_found' | 'ambiguous';
  drugQuery: string;
  normalizedDrugQuery: string;
  snapshot?: LabelSnapshot;
  // If ambiguous, show user options
  options?: Array<{
    brandNames: string[];
    genericNames: string[];
    activeIngredients: string[];
    setId?: string;
    effectiveTime?: string;
  }>;
  reason?: string;
}
