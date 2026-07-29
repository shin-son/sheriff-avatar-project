// retrieval 자기교정 Phase 1 — case-log 엔트리 파싱(①) + 재발 가중(②) 순수 함수 테스트.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { caseLogEntries, recurrenceBoost } from './wiki-query.mjs'

test('caseLogEntries: 포인터(재발 추정/재해결 →) 엔트리는 제외한다 (①)', () => {
  const log = [
    '## CIOPS-1 — auth.token.sh Failed',
    '- module: auth',
    '- symptom: 토큰 401',
    '',
    '## CIOPS-2 — auth.token.sh Failed (재발 추정 → CIOPS-1, 누적 2건)',
    '- module: auth',
    '- ref: 해결 근거는 CIOPS-1 참조',
    '',
    '## CIOPS-3 — auth.token.sh Failed (재해결 → CIOPS-1, 누적 3건)',
    '- module: auth'
  ].join('\n')
  const e = caseLogEntries(log)
  assert.deepEqual(e.map((x) => x.id), ['CIOPS-1']) // 포인터 2개 제외, anchor만
  assert.equal(e[0].module, 'auth')
})

test('caseLogEntries: 같은 id의 full 엔트리는 최신만 (reopen 교정본 supersede)', () => {
  const log = [
    '## CIOPS-1 — auth.token.sh Failed',
    '- resolution: 임시 우회 (틀린 첫 해결)',
    '',
    '## CIOPS-1 — auth.token.sh Failed (재해결 #2)',
    '- resolution: 만료 재발급 로직 (교정본)'
  ].join('\n')
  const e = caseLogEntries(log)
  assert.equal(e.length, 1)
  assert.match(e[0].body, /교정본/)
  assert.doesNotMatch(e[0].body, /틀린 첫 해결/)
})

test('recurrenceBoost: count 1 이하는 0, 이상은 count-1 (상한 cap)', () => {
  assert.equal(recurrenceBoost(1), 0)
  assert.equal(recurrenceBoost(0), 0)
  assert.equal(recurrenceBoost(undefined), 0)
  assert.equal(recurrenceBoost(3), 2)
  assert.equal(recurrenceBoost(10, 4), 4) // 상한
})
