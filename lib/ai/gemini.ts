import 'server-only';
import {requestGemini as requestGeminiHttp} from './gemini-request';
export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
export async function requestGemini(systemPrompt: string, parts: GeminiPart[], schema: Record<string, unknown>, maxOutputTokens = 1024, temperature = 0.9, modelOverride?: string, deadline = Date.now()+55000) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("The AI is offline. AI setup is not complete yet.");
  const model = modelOverride || process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
  if (!/^[a-zA-Z0-9.-]+$/.test(model)) throw new Error("The AI model configuration is invalid.");
  let response: Response;
  try {
    response = await requestGeminiHttp(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts }], generationConfig: { temperature, maxOutputTokens, responseMimeType: "application/json", responseJsonSchema: schema } }),
      cache: "no-store",
    },deadline);
  } catch { throw new Error("The AI is taking too long to respond. Please try again."); }
  if (!response.ok) {
    // Inspect provider errors without returning/logging keys, photos or raw messages.
    let provider: { error?: { message?: string; details?: { reason?: string }[] } } = {};
    try { provider = await response.json(); } catch { /* HTTP status still identifies the failure. */ }
    const message = typeof provider.error?.message === "string" ? provider.error.message : "";
    const details = Array.isArray(provider.error?.details) ? provider.error.details : [];
    const reasons = details.map(detail => detail?.reason);
    let diagnostic = "PROVIDER_ERROR";
    let guidance = "The AI service could not complete the request. Please try again.";
    if (response.status === 429) {
      diagnostic = "QUOTA"; guidance = "The free AI quota is busy or exhausted. Please try later; billing is not required for this app.";
    } else if (response.status === 401 || reasons.includes("API_KEY_INVALID") || /api key.*(not valid|invalid|expired)/i.test(message)) {
      diagnostic = "KEY_REJECTED"; guidance = "Gemini rejected the API key. Recopy the full key into Vercel GEMINI_API_KEY and redeploy.";
    } else if (reasons.includes("SERVICE_DISABLED") || /has not been used.*project|service.*disabled|api.*not.*enabled/i.test(message)) {
      diagnostic = "API_DISABLED"; guidance = "The Gemini API is disabled for this key’s Google project. Check the project’s Generative Language API access.";
    } else if (response.status === 404 || /not.*available.*new users|model.*(not found|not available|no longer available)/i.test(message)) {
      diagnostic = "MODEL_UNAVAILABLE"; guidance = "This Gemini model is unavailable to this project. Set GEMINI_MODEL to gemini-3.1-flash-lite in Vercel and redeploy.";
    } else if (response.status === 403) {
      diagnostic = "ACCESS_DENIED"; guidance = "Gemini denied this key or project access. Check the key’s API restrictions and model access in Google AI Studio.";
    } else if (response.status === 400) {
      diagnostic = "INVALID_REQUEST"; guidance = "Gemini rejected the request format. Check the selected model supports image input and structured text output.";
    } else if (response.status >= 500) {
      diagnostic = "PROVIDER_UNAVAILABLE"; guidance = "Gemini is temporarily unavailable. Please try again later.";
    }
    console.error("Foodfolio Gemini request failed", { httpStatus: response.status, diagnostic, model });
    throw new Error(`${guidance} (HTTP ${response.status}, ${diagnostic})`);
  }
  let data;
  try { data = await response.json(); } catch { throw new Error("The AI service returned an unreadable response."); }
  const responseParts = data.candidates?.[0]?.content?.parts;
  const text = Array.isArray(responseParts) ? responseParts.filter((part: { thought?: boolean; text?: string }) => !part.thought).map((part: { text?: string }) => part.text || "").join("") : "";
  return { text, model, inputTokens: typeof data.usageMetadata?.promptTokenCount === "number" ? data.usageMetadata.promptTokenCount : null, outputTokens: typeof data.usageMetadata?.candidatesTokenCount === "number" ? data.usageMetadata.candidatesTokenCount : null };
}
