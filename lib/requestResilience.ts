import { fetchWithTimeout } from '@/lib/request'

export { fetchWithTimeout } from '@/lib/request'

export class RequestTimeoutError extends Error {
  constructor(message = 'İstek zaman aşımına uğradı.') {
    super(message)
    this.name = 'RequestTimeoutError'
  }
}

export async function fetchJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
) {
  const response = await fetchWithTimeout(input, init, timeoutMs)
  const data = await response.json().catch(() => null) as T | null
  return { response, data }
}

export function uploadFormDataWithProgress<T>(
  url: string,
  body: FormData,
  onProgress: (progress: number) => void,
  timeoutMs = 180_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.timeout = timeoutMs
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onerror = () => reject(new Error('Bağlantı kesildi. İş daha sonra yeniden denenebilir.'))
    xhr.ontimeout = () => reject(new RequestTimeoutError('Yükleme zaman aşımına uğradı.'))
    xhr.onabort = () => reject(new DOMException('Yükleme iptal edildi.', 'AbortError'))
    xhr.onload = () => {
      let data: unknown = null
      try { data = JSON.parse(xhr.responseText) } catch { /* handled below */ }
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : `Yükleme başarısız (${xhr.status})`
        reject(new Error(message))
        return
      }
      onProgress(100)
      resolve(data as T)
    }
    xhr.send(body)
  })
}
