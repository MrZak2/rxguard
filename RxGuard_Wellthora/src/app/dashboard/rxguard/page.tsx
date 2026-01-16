"use client";

import { useMemo, useState } from 'react';
import { rxguardMedicationSafety, type RxGuardOutput } from '@/ai/flows/rxguard-answer-flow';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2, ShieldAlert, FileText, Bot, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

function riskBadgeVariant(risk: RxGuardOutput['risk']): string {
  if (risk === 'HIGH') return 'destructive';
  if (risk === 'MODERATE') return 'secondary';
  return 'outline';
}

export default function RxGuardPage() {
  const [primaryDrug, setPrimaryDrug] = useState('');
  const [question, setQuestion] = useState('');
  const [otherMeds, setOtherMeds] = useState('');
  const [conditions, setConditions] = useState('');
  const [pregnancy, setPregnancy] = useState<'no' | 'trying' | 'pregnant_t1' | 'pregnant_t2' | 'pregnant_t3' | 'unknown'>('unknown');
  const [includeNaked, setIncludeNaked] = useState(true);
  const [nakedModel, setNakedModel] = useState<'mistral-7b' | 'llama3-8b' | 'both'>('both');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RxGuardOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedOtherMeds = useMemo(
    () => otherMeds.split(',').map(s => s.trim()).filter(Boolean),
    [otherMeds]
  );
  const parsedConditions = useMemo(
    () => conditions.split(',').map(s => s.trim()).filter(Boolean),
    [conditions]
  );

  const run = async () => {
    setError(null);
    setLoading(true);
    try {
      const out = await rxguardMedicationSafety({
        question,
        primaryDrug,
        otherMeds: parsedOtherMeds,
        profile: {
          pregnancy,
          conditions: parsedConditions,
          currentMeds: parsedOtherMeds,
        },
        includeNakedModelAnswer: includeNaked,
        nakedModel,
      });
      setResult(out);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadDemoTrap = () => {
    setPrimaryDrug('Advil');
    setQuestion('Is Advil safe for my headache?');
    setOtherMeds('Warfarin');
    setConditions('stomach ulcers');
    setPregnancy('unknown');
    setIncludeNaked(true);
    setNakedModel('both');
    setResult(null);
    setError(null);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-headline tracking-wide">RxGuard</h1>
          <p className="text-muted-foreground max-w-2xl">
            Policy-enforced, evidence-linked medication safety gating using FDA drug label snapshots.
          </p>
        </div>
        <Button variant="outline" onClick={loadDemoTrap}>
          <Sparkles className="h-4 w-4 mr-2" /> Load demo trap
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-headline tracking-wide">Ask RxGuard</CardTitle>
          <CardDescription>
            Tip: For best results, type the exact medication name on the package (and strength if possible).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Medication (required)</Label>
              <Input
                placeholder="e.g., Advil, Ibuprofen 200mg, Lisinopril 10mg"
                value={primaryDrug}
                onChange={(e) => setPrimaryDrug(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Pregnancy status (optional)</Label>
              <Select value={pregnancy} onValueChange={(v) => setPregnancy(v as any)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Unknown / Prefer not to say</SelectItem>
                  <SelectItem value="no">Not pregnant</SelectItem>
                  <SelectItem value="trying">Trying to conceive</SelectItem>
                  <SelectItem value="pregnant_t1">Pregnant (1st trimester)</SelectItem>
                  <SelectItem value="pregnant_t2">Pregnant (2nd trimester)</SelectItem>
                  <SelectItem value="pregnant_t3">Pregnant (3rd trimester)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Other medications (comma-separated, optional)</Label>
              <Input
                placeholder="e.g., Warfarin, Metformin"
                value={otherMeds}
                onChange={(e) => setOtherMeds(e.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Conditions (comma-separated, optional)</Label>
              <Input
                placeholder="e.g., stomach ulcers, CKD"
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Your question</Label>
              <Textarea
                placeholder="e.g., Is it safe to take this for a headache?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Switch checked={includeNaked} onCheckedChange={setIncludeNaked} />
              <div>
                <Label className="text-sm">Show baseline “naked model” output</Label>
                <p className="text-xs text-muted-foreground">For the side-by-side demo.</p>
              </div>
            </div>
            <div className={cn("flex items-center gap-2", !includeNaked && "opacity-50 pointer-events-none")}> 
              <Label className="text-sm">Baseline:</Label>
              <Select value={nakedModel} onValueChange={(v) => setNakedModel(v as any)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Mistral + Llama</SelectItem>
                  <SelectItem value="mistral-7b">Mistral 7B</SelectItem>
                  <SelectItem value="llama3-8b">Llama 3 8B</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={run} disabled={loading || !primaryDrug || !question}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldAlert className="h-4 w-4 mr-2" />}
              Run RxGuard
            </Button>
          </div>

          {error && (
            <div className="p-3 rounded-md border border-destructive/40 bg-destructive/10 text-sm">
              <b>Error:</b> {error}
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Baseline */}
          {includeNaked && (
            <Card>
              <CardHeader>
                <CardTitle className="font-headline tracking-wide flex items-center gap-2"><Bot className="h-5 w-5" /> Baseline Output</CardTitle>
                <CardDescription>Ungrounded output (no evidence gate).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {result.naked?.mistral7b && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1">Mistral 7B</div>
                    <pre className="text-xs whitespace-pre-wrap bg-muted/50 p-3 rounded-md">{result.naked.mistral7b}</pre>
                  </div>
                )}
                {result.naked?.llama3_8b && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1">Llama 3 8B</div>
                    <pre className="text-xs whitespace-pre-wrap bg-muted/50 p-3 rounded-md">{result.naked.llama3_8b}</pre>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* RxGuard */}
          <Card>
            <CardHeader>
              <CardTitle className="font-headline tracking-wide flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> RxGuard Output</CardTitle>
              <CardDescription>Deterministic policy decision + evidence-linked proof card.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={riskBadgeVariant(result.risk) as any}>Risk: {result.risk}</Badge>
                <Badge variant="outline">Decision: {result.decision}</Badge>
              </div>

              <pre className="text-sm whitespace-pre-wrap bg-muted/50 p-4 rounded-md">{result.message}</pre>

              {result.proofCard && (
                <Accordion type="single" collapsible>
                  <AccordionItem value="proof">
                    <AccordionTrigger>
                      <div className="flex items-center gap-2"><FileText className="h-4 w-4" /> Proof Card (FDA label evidence)</div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3">
                      <div className="text-xs text-muted-foreground">
                        set_id: <b>{result.proofCard.setId}</b> · effective_time: <b>{result.proofCard.effectiveTime}</b>
                        <br />
                        evidence hash: <span className="font-mono">{result.proofCard.evidenceHash.slice(0, 16)}…</span>
                      </div>
                      <div className="space-y-2">
                        {result.proofCard.quotes.map((q, i) => (
                          <div key={i} className="p-3 rounded-md border bg-background">
                            <div className="text-xs font-semibold text-muted-foreground mb-1">[{q.section}]</div>
                            <div className="text-xs whitespace-pre-wrap">{q.quote}</div>
                            {q.reason && <div className="text-xs text-muted-foreground mt-2">{q.reason}</div>}
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
