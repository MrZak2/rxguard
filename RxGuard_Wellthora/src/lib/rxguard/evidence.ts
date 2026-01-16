import { EvidenceSections, LabelSnapshot, OpenFdaLabelRecord } from './types';
import { normalizeForMatch, sha256Hex, safeOneLine } from './utils';

function joinSection(v?: string[] | string): string {
  if (!v) return '';
  if (Array.isArray(v)) return v.map((s) => safeOneLine(s)).join('\n');
  return safeOneLine(v);
}

export function extractEvidenceSections(record: OpenFdaLabelRecord): EvidenceSections {
  return {
    activeIngredients: joinSection(record.active_ingredient),
    boxedWarning: joinSection(record.boxed_warning),
    contraindications: joinSection(record.contraindications),
    warnings: joinSection(record.warnings),
    warningsAndCautions: joinSection(record.warnings_and_cautions),
    drugInteractions: joinSection(record.drug_interactions),
    pregnancy: joinSection(record.pregnancy),
    lactation: joinSection(record.lactation),
    pediatricUse: joinSection(record.pediatric_use),
    geriatricUse: joinSection(record.geriatric_use),
    doNotUse: joinSection(record.do_not_use),
    askDoctor: joinSection(record.ask_doctor),
  };
}

export function buildCanonicalEvidenceText(sections: EvidenceSections): string {
  const parts: Array<[string, string]> = [
    ['ACTIVE INGREDIENTS', sections.activeIngredients],
    ['BOXED WARNING', sections.boxedWarning],
    ['CONTRAINDICATIONS', sections.contraindications],
    ['WARNINGS', sections.warnings],
    ['WARNINGS AND CAUTIONS', sections.warningsAndCautions],
    ['DRUG INTERACTIONS', sections.drugInteractions],
    ['PREGNANCY', sections.pregnancy],
    ['LACTATION', sections.lactation],
    ['PEDIATRIC USE', sections.pediatricUse],
    ['GERIATRIC USE', sections.geriatricUse],
    ['DO NOT USE', sections.doNotUse],
    ['ASK A DOCTOR', sections.askDoctor],
  ];

  // Stable, reproducible canonical text
  return parts
    .map(([title, body]) => {
      const clean = safeOneLine(body).replace(/\s+/g, ' ').trim();
      return `=== ${title} ===\n${clean}`;
    })
    .join('\n\n');
}

export function buildLabelSnapshot(record: OpenFdaLabelRecord): LabelSnapshot {
  const setId = record.set_id ?? '';
  const effectiveTime = record.effective_time ?? '';
  if (!setId || !effectiveTime) {
    throw new Error('openFDA record missing set_id/effective_time; cannot pin evidence.');
  }

  const sections = extractEvidenceSections(record);
  const evidenceText = buildCanonicalEvidenceText(sections);
  const evidenceHash = sha256Hex(evidenceText);

  const brandNames = record.openfda?.brand_name ?? [];
  const genericNames = record.openfda?.generic_name ?? [];
  const activeIngredientsList = record.active_ingredient ?? [];

  return {
    setId,
    effectiveTime,
    evidenceHash,
    evidenceText,
    sections,
    brandNames,
    genericNames,
    activeIngredientsList,
  };
}

export function quoteExistsInEvidence(evidenceText: string, quote: string): boolean {
  const ev = normalizeForMatch(evidenceText);
  const q = normalizeForMatch(quote);
  return !!q && ev.includes(q);
}