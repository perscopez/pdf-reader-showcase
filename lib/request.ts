/** Fetch with a bounded wait so a stalled network request cannot leave a UI in a permanent loading state. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController()
  const upstream = init.signal
  const forwardAbort = () => controller.abort(upstream?.reason)
  if (upstream) {
    if (upstream.aborted) forwardAbort()
    else upstream.addEventListener('abort', forwardAbort, { once: true })
  }

  const timeout = globalThis.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    globalThis.clearTimeout(timeout)
    upstream?.removeEventListener('abort', forwardAbort)
  }
}
