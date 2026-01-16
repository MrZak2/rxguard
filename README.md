## RxGuard

RxGuard is a policy-enforced, evidence-linked medication safety layer that cross-references user context against official FDA drug labels. It is designed to intercept and correct unsafe AI guidance using deterministic rules and verifiable citations.

### Summary

- Deterministic policy decisions: BLOCK, CAUTION, CLARIFY, INFO
- FDA label pinning with openFDA snapshots
- Verifiable evidence quotes (substring-verified)
- Profile-aware risk checks (pregnancy, conditions, current medications)
- Optional side-by-side baseline model outputs for demo comparison

### Quick Start

#### Prerequisites

- Node.js 18+
- Firebase project with Storage enabled
- (Optional) openFDA API key
- (Optional) Local LLM server for demo outputs

#### Install

```bash
git clone https://github.com/yourusername/rxguard.git
cd rxguard/RxGuard_Wellthorav2
npm install
npm i firebase-admin
```

#### Configure

Copy the environment template and set values:

```bash
cp rxguard.env.example .env.local
```

Example `.env.local`:

```env
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

OPENFDA_API_KEY=your_api_key

RXGUARD_LLM_PROVIDER=openai_compat
RXGUARD_LLM_BASE_URL=http://localhost:8000
RXGUARD_MISTRAL_MODEL=mistral-7b
RXGUARD_LLAMA_MODEL=llama3-8b
```

#### Run

```bash
npm run dev
```

Open `http://localhost:3000/dashboard/rxguard`.

### Architecture

1. Resolve drug name to a pinned FDA label snapshot
2. Evaluate deterministic policy rules against label evidence and user profile
3. Generate a proof card with verified evidence quotes
4. Optionally request baseline model outputs for side-by-side comparison

### Decision Types

| Decision | Risk | Meaning |
|---|---|---|
| BLOCK | HIGH | Strong contraindication detected |
| CAUTION | MODERATE | Potential risks identified |
| CLARIFY | UNKNOWN | Missing or ambiguous inputs |
| INFO | LOW | No high-severity matches found |

### Project Structure

```
RxGuard_Wellthorav2/
	src/
		ai/flows/                 # Genkit flow integration
		app/dashboard/rxguard/    # UI route
		lib/rxguard/              # Core engine (policy, evidence, FDA)
	scripts/rxguard/            # Utilities (seedSyntheticProfiles)
	rxguard.env.example
	RXGUARD_INSTALL.md
```

### API Usage

```ts
import { rxguardAnswer } from '@/lib/rxguard/rxguard';

const response = await rxguardAnswer({
	question: 'Is Advil safe for my headache?',
	primaryDrug: 'Advil',
	otherMeds: ['Warfarin'],
	profile: {
		pregnancy: 'unknown',
		conditions: ['stomach ulcers'],
		currentMeds: ['Warfarin'],
	},
	includeNakedModelAnswer: false,
});
```

### RxBench Dataset

The repository includes a dataset of FDA-label-derived medication safety scenarios:

```
RxBench 200k FDA-Label–Derived Medication Safety Scenarios.jsonl
```

Use it to benchmark policy coverage and evaluate guardrail performance.

### Disclaimers

RxGuard is for educational and research use only. It does not provide medical advice and cannot confirm medication safety. Always consult a licensed clinician or pharmacist for medication decisions.

### Development Notes

Seed synthetic profiles:

```bash
npx tsx scripts/rxguard/seedSyntheticProfiles.ts
```

Genkit dev (optional): ensure `src/ai/dev.ts` imports `@/ai/flows/rxguard-answer-flow.ts`.

### License

MIT License. See the LICENSE file for details.
