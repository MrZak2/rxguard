'use server';

/**
 * RxGuard Flow
 *
 * Server action / Genkit flow wrapper around the deterministic RxGuard engine.
 *
 * IMPORTANT: This flow is intentionally conservative. It does not provide
 * medical advice; it returns evidence-linked warnings + safe gating.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { rxguardAnswer } from '@/lib/rxguard/rxguard';

const RxGuardProfileSchema = z
  .object({
    age: z.number().int().positive().optional(),
    sex: z.enum(['M', 'F', 'Other', 'Unknown']).optional(),
    pregnancy: z
      .enum(['no', 'trying', 'pregnant_t1', 'pregnant_t2', 'pregnant_t3', 'unknown'])
      .optional(),
    conditions: z.array(z.string()).optional(),
    currentMeds: z.array(z.string()).optional(),
    allergies: z.array(z.string()).optional(),
  })
  .optional();

const RxGuardInputSchema = z.object({
  question: z.string().min(1),
  primaryDrug: z.string().min(1).optional(),
  otherMeds: z.array(z.string()).optional(),
  profile: RxGuardProfileSchema,
  includeNakedModelAnswer: z.boolean().optional(),
  nakedModel: z.enum(['mistral-7b', 'llama3-8b', 'both']).optional(),
});

const EvidenceQuoteSchema = z.object({
  section: z.string(),
  quote: z.string(),
  reason: z.string().optional(),
});

const ProofCardSchema = z.object({
  source: z.literal('openFDA'),
  setId: z.string(),
  effectiveTime: z.string(),
  evidenceHash: z.string(),
  quotes: z.array(EvidenceQuoteSchema),
});

const RxGuardOutputSchema = z.object({
  decision: z.enum(['BLOCK', 'CAUTION', 'CLARIFY', 'INFO']),
  risk: z.enum(['HIGH', 'MODERATE', 'LOW', 'UNKNOWN']),
  message: z.string(),
  clarifyingQuestion: z.string().optional(),
  proofCard: ProofCardSchema.optional(),
  naked: z
    .object({
      mistral7b: z.string().optional(),
      llama3_8b: z.string().optional(),
    })
    .optional(),
  debug: z
    .object({
      primaryDrugResolved: z.string().optional(),
      rulesTriggered: z.array(z.string()),
      labelDocId: z.string().optional(),
    })
    .optional(),
});

export type RxGuardInput = z.infer<typeof RxGuardInputSchema>;
export type RxGuardOutput = z.infer<typeof RxGuardOutputSchema>;

export async function rxguardMedicationSafety(input: RxGuardInput): Promise<RxGuardOutput> {
  return rxguardAnswer(input);
}

// Optional: register as Genkit flow (useful for genkit dev UI)
export const rxguardAnswerFlow = ai.defineFlow(
  {
    name: 'rxguardAnswerFlow',
    inputSchema: RxGuardInputSchema,
    outputSchema: RxGuardOutputSchema,
  },
  async (input) => {
    return rxguardAnswer(input);
  }
);
