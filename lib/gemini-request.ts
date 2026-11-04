const retryableStatuses = new Set([500, 502, 503, 504]);

export async function requestGemini(url: string, options: RequestInit, deadline: number) {
  for (const timeout of [30000, 18000]) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    try {
      const response = await fetch(url, {...options, signal: AbortSignal.timeout(Math.min(timeout, remaining))});
      if (!retryableStatuses.has(response.status)) return response;
      await response.body?.cancel();
    } catch (error) {
      if (!(error instanceof TypeError) && !(error instanceof DOMException && ['TimeoutError','AbortError'].includes(error.name))) throw error;
    }

    if (timeout === 30000 && deadline - Date.now() > 1000) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error('Gemini is temporarily unavailable or timed out after a retry. Your photo is still selected. Try Generate media again in a moment.');
}
