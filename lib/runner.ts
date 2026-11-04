export type Step = { id: string; name: string; instruction: string; model: string; position: number; temperature: number; max_output_tokens: number };
export type Trace = { instruction?:string; name: string; model: string; duration: number; text: string };

export async function runChain(
  steps: Step[],
  input: string,
  image: { mimeType: string; data: string } | null,
  generate: (step: Step, input: string, image: { mimeType: string; data: string } | null) => Promise<string>,
) {
  const trace: Trace[] = [];
  let previous = input;
  for (const step of [...steps].sort((left, right) => left.position - right.position)) {
    const start = Date.now();
    try {
      previous = (await generate(step, previous, trace.length === 0 ? image : null)).trim();
      if (!previous || previous.length > 16000) throw new Error('No usable text was returned.');
      trace.push({instruction:step.instruction,name: step.name, model: step.model, duration: Date.now() - start, text: previous});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed.';
      return {status: 'failed', output: `Step ${step.position} · ${step.name}: ${message}`, trace};
    }
  }
  return {status: 'succeeded', output: previous, trace};
}
