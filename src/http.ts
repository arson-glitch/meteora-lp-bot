export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getJson<T>(
  url: string,
  init?: { timeoutMs?: number; headers?: Record<string, string> },
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 20_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        "user-agent": "meteora-lp-bot/0.1",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const error = new Error(`HTTP ${res.status} for ${url}`) as Error & { status?: number };
      error.status = res.status;
      throw error;
    }
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms fetching ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
