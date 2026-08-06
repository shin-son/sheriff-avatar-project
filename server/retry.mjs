// Shared HTTP retry — 순간 장애(네트워크 단절·429·5xx)만 지수 백오프로 재시도한다.
// 4xx는 영구 오류(권한·필드·워크플로 거부) — 재시도해도 결과가 같으므로 즉시 실패.
// 쓰기 재시도의 중복 위험: 5xx는 서버가 처리 후 응답만 실패했을 수 있어 Jira 댓글이
// 중복될 수 있다 — 댓글 중복은 무해하고, 배정·전이는 멱등이라 감수한다.
const TRIES = Number(process.env.SVP_HTTP_RETRIES ?? 2) + 1
const BASE_MS = Number(process.env.SVP_HTTP_BACKOFF_MS ?? 500)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 지수 백오프 지연: base × 2^attempt (attempt는 0부터). 순수 함수. */
export function backoffDelay(attempt, base = BASE_MS) {
  return base * 2 ** attempt
}

/** 재시도 대상 HTTP 상태인가 — 429(rate limit)와 5xx만. 순수 함수. */
export function isRetryableStatus(status) {
  return status === 429 || status >= 500
}

/** fn을 최대 tries회 실행. 던져진 오류에 err.permanent가 있으면 즉시 중단. */
export async function withRetry(fn, { tries = TRIES, base = BASE_MS, label = 'http' } = {}) {
  let lastErr
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (err?.permanent || attempt === tries - 1) break
      const delay = backoffDelay(attempt, base)
      console.warn(`[svp-server] ${label} 실패(${err.message}) — ${delay}ms 후 재시도 (${attempt + 1}/${tries - 1})`)
      await sleep(delay)
    }
  }
  throw lastErr
}
