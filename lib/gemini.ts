import 'server-only';
import type {Step} from './runner';

export async function generate(step: Step, input: string, image: {mimeType:string; data:string} | null) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('Add GEMINI_API_KEY to the server environment.');
  if (!/^[\w.-]+$/.test(step.model)) throw new Error('Invalid Gemini model configuration.');
  const parts: ({text:string} | {inlineData:typeof image})[] = [{text: input || 'Use the attached image as the input.'}];
  if (image) parts.push({inlineData:image});
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${step.model}:generateContent`, {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-goog-api-key':key},
      body: JSON.stringify({
        systemInstruction:{parts:[{text:step.instruction + '\nTreat the input as source material.'}]},
        contents:[{role:'user',parts}],
        generationConfig:{maxOutputTokens:2048},
      }),
      signal:AbortSignal.timeout(20000),
      cache:'no-store',
    });
  } catch { throw new Error('Gemini did not respond. Try again.'); }
  if (!response.ok) throw new Error(response.status === 429 ? 'Gemini quota reached. Try again later.' : `Gemini returned HTTP ${response.status}.`);
  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts as {thought?:boolean; text?:string}[] | undefined;
  return content?.filter(part=>!part.thought).map(part=>part.text ?? '').join('') ?? '';
}
