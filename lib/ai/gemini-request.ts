const retryableStatuses = new Set([500, 502, 503, 504]);

export async function requestGemini(url: string, options: RequestInit, deadline: number) {
  let lastFailure = 'request timed out';
  for (const [attempt, timeout] of [35000, 35000, 35000].entries()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    try {
      const response = await fetch(url, {...options, signal: AbortSignal.timeout(Math.min(timeout, remaining))});
      if (!retryableStatuses.has(response.status)) return response;
      lastFailure = 'HTTP ' + response.status;
      console.warn('Gemini transient failure', {status:response.status,attempt:attempt+1});
      await response.body?.cancel();
    } catch (error) {
      lastFailure = error instanceof Error ? error.name : 'NetworkError';
      console.warn('Gemini request interrupted', {reason:lastFailure,attempt:attempt+1});
      if (!(error instanceof TypeError) && !(error instanceof DOMException && ['TimeoutError','AbortError'].includes(error.name))) throw error;
    }

    if (attempt < 2 && deadline - Date.now() > 2000) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw new Error(`Gemini could not complete this step after retries (${lastFailure}). Your photo is still selected. Try again shortly.`);
}
