// decideIngest 회귀 테스트 — 해결 이벤트 단위 멱등성.
// reopen 후 재해결(더 늦은 resolvedAt)만 재기록하고, 재시작·중복 폴링(같은 resolvedAt)은
// 스킵해 case-log/raw 중복·덮어쓰기를 막는지 보장.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideIngest, signatureOf, isDuplicateRecurrence, classifyIngest } from './ingest.mjs'

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

// ── D: 중복 dedup ─────────────────────────────────────────────────────────
const DAY = 24 * 60 * 60 * 1000

test('signatureOf: 로그의 TC name 우선', () => {
  assert.equal(
    signatureOf({ log: 'TC name or file : auth.token-refresh.sh\nFail Log: ...', title: '[x] Foo Failed' }),
    'auth.token-refresh.sh'
  )
})

test('signatureOf: TC 없으면 제목 정규화([..] 접두·Failed 접미 제거)', () => {
  assert.equal(
    signatureOf({ log: 'no tc marker', title: '[DEV_CICD][proj][T1] : auth.login.sh Failed' }),
    'auth.login.sh'
  )
})

test('isDuplicateRecurrence: 다른 티켓·같은 모듈·시간창 내 = 재발', () => {
  const prev = { anchorKey: 'CIOPS-1', module: 'auth', count: 1, lastAt: '2026-07-29T00:00:00.000Z' }
  assert.equal(
    isDuplicateRecurrence(prev, { key: 'CIOPS-2', module: 'auth', at: '2026-07-29T05:00:00.000Z', n: 1 }, 14 * DAY),
    true
  )
})

test('isDuplicateRecurrence: anchor 자기자신·재해결(n>1)·다른 모듈·창 만료는 재발 아님', () => {
  const prev = { anchorKey: 'CIOPS-1', module: 'auth', count: 1, lastAt: '2026-07-29T00:00:00.000Z' }
  // 같은 티켓(anchor 재해결)
  assert.equal(isDuplicateRecurrence(prev, { key: 'CIOPS-1', module: 'auth', at: '2026-07-29T05:00:00.000Z', n: 1 }, 14 * DAY), false)
  // reopen 재해결 n>1
  assert.equal(isDuplicateRecurrence(prev, { key: 'CIOPS-2', module: 'auth', at: '2026-07-29T05:00:00.000Z', n: 2 }, 14 * DAY), false)
  // 다른 모듈
  assert.equal(isDuplicateRecurrence(prev, { key: 'CIOPS-2', module: 'payment', at: '2026-07-29T05:00:00.000Z', n: 1 }, 14 * DAY), false)
  // 시간창 만료(20일 뒤)
  assert.equal(isDuplicateRecurrence(prev, { key: 'CIOPS-2', module: 'auth', at: '2026-08-18T00:00:00.000Z', n: 1 }, 14 * DAY), false)
  // prev 없음
  assert.equal(isDuplicateRecurrence(undefined, { key: 'CIOPS-2', module: 'auth', at: '2026-07-29T05:00:00.000Z', n: 1 }, 14 * DAY), false)
})

// ── classifyIngest: dedup 모드 판정 (anchor-reset 버그 회귀 방지) ──────────
test('classifyIngest: 신규 서명은 full', () => {
  assert.equal(classifyIngest(undefined, { key: 'A', module: 'auth', at: '2026-07-29T00:00:00.000Z', n: 1 }, 14 * DAY), 'full')
})

test('classifyIngest: anchor 티켓 재해결은 anchor-reresolve', () => {
  const prev = { anchorKey: 'A', module: 'auth', count: 2, tickets: ['A', 'B'], lastAt: '2026-07-29T00:00:00.000Z' }
  assert.equal(classifyIngest(prev, { key: 'A', module: 'auth', at: '2026-07-29T05:00:00.000Z', n: 2 }, 14 * DAY), 'anchor-reresolve')
})

test('classifyIngest: 이미 dedup된 비-anchor 티켓의 재해결은 member-reresolve (버그 수정)', () => {
  // 이 케이스가 예전엔 full로 빠져 anchor를 B로 덮어쓰고 재발 이력을 소실시켰다.
  const prev = { anchorKey: 'A', module: 'auth', count: 2, tickets: ['A', 'B'], lastAt: '2026-07-29T00:00:00.000Z' }
  assert.equal(classifyIngest(prev, { key: 'B', module: 'auth', at: '2026-07-29T06:00:00.000Z', n: 2 }, 14 * DAY), 'member-reresolve')
})

test('classifyIngest: 새 중복 티켓(창 내)은 recurrence, 창 만료는 full', () => {
  const prev = { anchorKey: 'A', module: 'auth', count: 1, tickets: ['A'], lastAt: '2026-07-29T00:00:00.000Z' }
  assert.equal(classifyIngest(prev, { key: 'C', module: 'auth', at: '2026-07-29T05:00:00.000Z', n: 1 }, 14 * DAY), 'recurrence')
  assert.equal(classifyIngest(prev, { key: 'C', module: 'auth', at: '2026-08-20T00:00:00.000Z', n: 1 }, 14 * DAY), 'full')
})
