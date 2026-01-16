import 'server-only';

import { quoteExistsInEvidence } from './evidence';
import { chatCompletion } from './llmClient';
import { evaluatePolicy } from './policy';
import { resolveDrugToPinnedLabel } from './labelCache';
import {
  EvidenceQuote,
  ProofCard,
  RxGuardRequest,
  RxGuardResponse,
} from './types';

function disclaimer(): string {
  return (
    'Educational use only. RxGuard is NOT medical advice and cannot confirm safety. '
    + 'Always consult a licensed clinician or pharmacist for medication decisions.'
  );
}

function buildCoreMessage(args: {
  decision: RxGuardResponse['decision'];
  risk: RxGuardResponse['risk'];
  primaryDrug: string;
  quotes: EvidenceQuote[];
  clarifyingQuestion?: string;
}): string {
  const { decision, risk, primaryDrug, quotes, clarifyingQuestion } = args;
  const qText = quotes
    .slice(0, 3)
    .map((q, i) => `(${i + 1}) [${q.section}] ${q.quote}`)
    .join('\n');

  if (decision === 'CLARIFY') {
    return (
      `RxGuard needs clarification before it can evaluate “${primaryDrug}”.\n` +
      (clarifyingQuestion ? `\nQuestion: ${clarifyingQuestion}\n` : '') +
      `\n${disclaimer()}`
    );
  }

  if (decision === 'BLOCK') {
    return (
      `RxGuard BLOCKED the request (risk: ${risk}) for “${primaryDrug}” based on FDA label evidence.\n` +
      `\nEvidence snippets (verbatim):\n${qText}\n` +
      `\n${disclaimer()}`
    );
  }

  if (decision === 'CAUTION') {
    return (
      `RxGuard flags CAUTION (risk: ${risk}) for “${primaryDrug}” based on FDA label evidence.\n` +
      `\nEvidence snippets (verbatim):\n${qText}\n` +
      `\n${disclaimer()}`
    );
  }

  // INFO
  return (
    `RxGuard found no high-severity matches in the FDA label snapshot for “${primaryDrug}” given the info provided.\n` +
    `This does NOT mean it is safe. Review the label and consult a clinician/pharmacist.\n` +
    (qText ? `\nEvidence snippets (verbatim):\n${qText}\n` : '') +
    `\n${disclaimer()}`
  );
}

function buildProofCard(args: {
  setId: string;
  effectiveTime: string;
  evidenceHash: string;
  evidenceText: string;
  quotes: EvidenceQuote[];
}): ProofCard {
  // Verify each quote is a substring of evidence (prevents fabricated citations).
  const verified = args.quotes.filter((q) => quoteExistsInEvidence(args.evidenceText, q.quote));
  return {
    source: 'openFDA',
    setId: args.setId,
    effectiveTime: args.effectiveTime,
    evidenceHash: args.evidenceHash,
    quotes: verified,
  };
}

function buildNakedSystemPrompt(): string {
  return (
    'You are a helpful assistant. Answer the user\'s question directly. '
    + 'Do not mention policies or FDA labels unless asked. '
    + 'Be concise.'
  );
}

function buildNakedUserPrompt(question: string, profile?: any, primaryDrug?: string, otherMeds?: string[]): string {
  const ctx: any = {
    primaryDrug: primaryDrug ?? null,
    otherMeds: otherMeds ?? [],
    profile: profile ?? null,
  };
  return (
    `User context (may be incomplete):\n${JSON.stringify(ctx, null, 2)}\n\n` +
    `Question: ${question}`
  );
}

async function maybeGetNakedAnswers(input: RxGuardRequest): Promise<RxGuardResponse['naked']> {
  if (!input.includeNakedModelAnswer) return undefined;

  const baseUrl = process.env.RXGUARD_LLM_BASE_URL;
  if (!baseUrl) {
    return {
      mistral7b: '[RXGUARD_LLM_BASE_URL not set]',
      llama3_8b: '[RXGUARD_LLM_BASE_URL not set]',
    };
  }

  const apiKey = process.env.RXGUARD_LLM_API_KEY;
  const mistralModel = process.env.RXGUARD_MISTRAL_MODEL ?? 'mistral-7b';
  const llamaModel = process.env.RXGUARD_LLAMA_MODEL ?? 'llama3-8b';

  const want = input.nakedModel ?? 'both';
  const userPrompt = buildNakedUserPrompt(input.question, input.profile, input.primaryDrug, input.otherMeds);
  const sys = buildNakedSystemPrompt();

  const out: RxGuardResponse['naked'] = {};

  if (want === 'mistral-7b' || want === 'both') {
    out.mistral7b = await chatCompletion({
      baseUrl,
      model: mistralModel,
      apiKey,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      maxTokens: 400,
    }).catch((e) => `[Mistral error] ${String(e)}`);
  }

  if (want === 'llama3-8b' || want === 'both') {
    out.llama3_8b = await chatCompletion({
      baseUrl,
      model: llamaModel,
      apiKey,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      maxTokens: 400,
    }).catch((e) => `[Llama error] ${String(e)}`);
  }

  return out;
}

/**
 * RxGuard: Policy-enforced, evidence-linked medication safety for LLM guidance.
 *
 * This function is designed to be called from a server action / Genkit flow.
 */
export async function rxguardAnswer(input: RxGuardRequest): Promise<RxGuardResponse> {
  const primaryDrug = (input.primaryDrug ?? '').trim();
  if (!primaryDrug) {
    // Even if the user asked “Is Advil safe?”, force explicit drug input for safety.
    return {
      decision: 'CLARIFY',
      risk: 'UNKNOWN',
      message:
        'RxGuard needs the exact medication name from the package to look up the correct FDA label.\n' +
        'Please enter the medication name (and ideally strength/dose).\n\n' +
        disclaimer(),
      clarifyingQuestion: 'What exact medication name (and strength) is on the package?',
      debug: { rulesTriggered: ['MISSING_PRIMARY_DRUG'] },
    };
  }

  // 1) Resolve + pin FDA label evidence
  const resolution = await resolveDrugToPinnedLabel(primaryDrug);
  if (resolution.kind === 'not_found') {
    return {
      decision: 'CLARIFY',
      risk: 'UNKNOWN',
      message:
        `RxGuard could not find an FDA drug label match for “${primaryDrug}”.\n` +
        'Try the generic name, or the exact product name from the bottle/box.\n\n' +
        disclaimer(),
      clarifyingQuestion: 'Can you provide the exact product name (and strength) from the package?',
      debug: { rulesTriggered: ['LABEL_NOT_FOUND'] },
      naked: await maybeGetNakedAnswers(input),
    };
  }

  if (resolution.kind === 'ambiguous') {
    const options = resolution.options?.slice(0, 4) ?? [];
    const optText = options
      .map((o, i) => {
        const name = (o.brandNames[0] ?? o.genericNames[0] ?? 'Unknown');
        const ai = o.activeIngredients.join('; ');
        return `${i + 1}) ${name} — Active ingredients: ${ai || 'unknown'}`;
      })
      .join('\n');
    return {
      decision: 'CLARIFY',
      risk: 'UNKNOWN',
      message:
        `Multiple different FDA label records matched “${primaryDrug}”.\n` +
        'To avoid mixing up formulations, RxGuard needs you to pick one.\n\n' +
        `${optText}\n\n` +
        disclaimer(),
      clarifyingQuestion:
        'Which formulation is yours (active ingredients + strength)?',
      debug: { rulesTriggered: ['LABEL_AMBIGUOUS'] },
      naked: await maybeGetNakedAnswers(input),
    };
  }

  const snapshot = resolution.snapshot!;

  // 2) Deterministic policy gate
  const policy = evaluatePolicy({
    snapshot,
    profile: input.profile,
    otherMeds: input.otherMeds,
  });

  const proofCard = buildProofCard({
    setId: snapshot.setId,
    effectiveTime: snapshot.effectiveTime,
    evidenceHash: snapshot.evidenceHash,
    evidenceText: snapshot.evidenceText,
    quotes: policy.quotes,
  });

  // 3) Deterministic safe message
  const message = buildCoreMessage({
    decision: policy.decision,
    risk: policy.risk,
    primaryDrug,
    quotes: proofCard.quotes,
    clarifyingQuestion: policy.clarifyingQuestion,
  });

  // 4) Optional: call “naked model” for side-by-side demo
  const naked = await maybeGetNakedAnswers(input);

  return {
    decision: policy.decision,
    risk: policy.risk,
    message,
    clarifyingQuestion: policy.clarifyingQuestion,
    proofCard,
    naked,
    debug: {
      primaryDrugResolved: primaryDrug,
      rulesTriggered: policy.rulesTriggered,
      labelDocId: `${snapshot.setId}_${snapshot.effectiveTime}`,
    },
  };
}
