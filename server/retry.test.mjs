// HTTP 재시도 헬퍼 — 백오프 산식·재시도 판정·중단 조건 테스트.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backoffDelay, isRetryableStatus, withRetry } from './retry.mjs'

test('backoffDelay: base × 2^attempt 지수 증가', () => {
  assert.equal(backoffDelay(0, 500), 500)
  assert.equal(backoffDelay(1, 500), 1000)
  assert.equal(backoffDelay(2, 500), 2000)
})

test('isRetryableStatus: 429·5xx만 재시도, 4xx·2xx는 아님', () => {
  assert.equal(isRetryableStatus(429), true)
  assert.equal(isRetryableStatus(500), true)
  assert.equal(isRetryableStatus(503), true)
  assert.equal(isRetryableStatus(400), false)
  assert.equal(isRetryableStatus(404), false)
  assert.equal(isRetryableStatus(200), false)
})

test('withRetry: 일시 실패 후 성공하면 결과를 돌려준다', async () => {
  let calls = 0
  const result = await withRetry(
    async () => {
      calls += 1
      if (calls < 3) throw new Error('transient')
      return 'ok'
    },
    { tries: 3, base: 1 }
  )
  assert.equal(result, 'ok')
  assert.equal(calls, 3)
})

test('withRetry: permanent 오류는 즉시 중단 (재시도 없음)', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1
        const err = new Error('HTTP 400')
        err.permanent = true
        throw err
      },
      { tries: 3, base: 1 }
    ),
    /HTTP 400/
  )
  assert.equal(calls, 1)
})

test('withRetry: 소진되면 마지막 오류를 던진다', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1
        throw new Error(`fail ${calls}`)
      },
      { tries: 3, base: 1 }
    ),
    /fail 3/
  )
  assert.equal(calls, 3)
})
