# RxGuard install checklist (Wellthora)

This repo includes a drop-in RxGuard engine that:

- Pins FDA label snapshots (openFDA)
- Uses deterministic policy rules (BLOCK/CAUTION/CLARIFY/INFO)
- Attaches an evidence-linked proof card (quotes are substring-verified)
- Optionally calls local LLMs for a side-by-side “naked model” demo

## 1) Install dependency

```bash
npm i firebase-admin
```

## 2) Environment variables

Copy `rxguard.env.example` into `.env.local` and set:

- `FIREBASE_STORAGE_BUCKET`
- `OPENFDA_API_KEY` (optional)
- (optional for demo) `RXGUARD_LLM_*`

## 3) Local Firebase Admin auth

Set `GOOGLE_APPLICATION_CREDENTIALS` to a service account JSON file.

## 4) Run

```bash
npm run dev
```

Visit `/dashboard/rxguard`.

## 5) (Optional) Genkit dev

Make sure `src/ai/dev.ts` imports `@/ai/flows/rxguard-answer-flow.ts`.

## 6) (Optional) Seed synthetic profiles

```bash
npx tsx scripts/rxguard/seedSyntheticProfiles.ts
```
