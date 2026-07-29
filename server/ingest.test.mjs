// decideIngest 회귀 테스트 — 해결 이벤트 단위 멱등성.
// reopen 후 재해결(더 늦은 resolvedAt)만 재기록하고, 재시작·중복 폴링(같은 resolvedAt)은
// 스킵해 case-log/raw 중복·덮어쓰기를 막는지 보장.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideIngest } from './ingest.mjs'

const T1 = '2026-07-29T00:00:00.000Z'
const T2 = '2026-07-29T10:00:00.000Z'

test('첫 해결은 항상 기록 (n=1)', () => {
  assert.deepEqual(decideIngest(undefined, T1), { skip: false, n: 1 })
})

test('같은 resolvedAt(재시작·중복 폴링)은 스킵', () => {
  assert.deepEqual(decideIngest({ at: T1, n: 1 }, T1), { skip: true, n: 1 })
})

test('이전 resolvedAt은 스킵 (역행 방지)', () => {
  assert.equal(decideIngest({ at: T2, n: 2 }, T1).skip, true)
})

test('더 늦은 resolvedAt(reopen 후 재해결)은 재기록 n+1', () => {
  assert.deepEqual(decideIngest({ at: T1, n: 1 }, T2), { skip: false, n: 2 })
  assert.deepEqual(decideIngest({ at: T2, n: 2 }, '2026-07-30T00:00:00.000Z'), { skip: false, n: 3 })
})

test('resolvedAt 부재 시: prev 있으면 스킵(중복 방지 우선), 없으면 첫 기록', () => {
  assert.equal(decideIngest({ at: T1, n: 1 }, undefined).skip, true)
  assert.deepEqual(decideIngest(undefined, undefined), { skip: false, n: 1 })
})
