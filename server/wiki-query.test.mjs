// retrieval 자기교정 Phase 1 — case-log 엔트리 파싱(①) + 재발 가중(②) 순수 함수 테스트.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { caseLogEntries, recurrenceBoost, feedbackDemotion } from './wiki-query.mjs'

test('caseLogEntries: 포인터(재발 추정/재해결 →) 엔트리는 제외한다 (①)', () => {
  const log = [
    '## CIOPS-1 — auth.token.sh Failed',
    '- module: auth',
    '- symptom: 토큰 401',
    '',
    '## CIOPS-2 — auth.token.sh Failed (재발(추정) → CIOPS-1, 누적 2건)', // ingest 실제 표기
    '- module: auth',
    '- ref: 해결 근거는 CIOPS-1 참조',
    '',
    '## CIOPS-3 — auth.token.sh Failed (재해결 → CIOPS-1, 누적 3건)',
    '- module: auth',
    '',
    '## CIOPS-4 — auth.token.sh Failed (재발 추정 → CIOPS-1, 누적 4건)', // 구형 표기
    '- module: auth'
  ].join('\n')
  const e = caseLogEntries(log)
  assert.deepEqual(e.map((x) => x.id), ['CIOPS-1']) // 포인터 3개 제외, anchor만
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

test('feedbackDemotion: 불일치 threshold 이상+일치보다 많으면 반감, 아니면 유지 (③)', () => {
  assert.equal(feedbackDemotion(8, undefined), 8) // 피드백 없음
  assert.equal(feedbackDemotion(8, { up: 0, down: 2 }, 3), 8) // threshold 미만
  assert.equal(feedbackDemotion(8, { up: 0, down: 3 }, 3), 4) // 반감
  assert.equal(feedbackDemotion(9, { up: 0, down: 3 }, 3), 4) // floor(9/2)
  assert.equal(feedbackDemotion(8, { up: 5, down: 3 }, 3), 8) // 일치가 더 많음 → 유지
})

// ── parseFrontmatter — 블록 리스트 지원 (사내 다중 담당 vault 형태) ──
import { parseFrontmatter, listOf, primaryOf } from './wiki-query.mjs'

test('parseFrontmatter: key: value 한 줄 형태 (기존 계약 유지)', () => {
  const fm = parseFrontmatter('---\ntype: module\nmodule: auth\nowner: alice\n---\n# auth')
  assert.equal(fm.owner, 'alice')
  assert.equal(fm.module, 'auth')
})

test('parseFrontmatter: YAML 블록 리스트 owner를 배열로 읽는다', () => {
  const fm = parseFrontmatter(
    '---\ntype: module\nmodule: audio\nowner:\n  - alice\n  - bob\ntags: [audio, alsa]\n---\n# audio'
  )
  assert.deepEqual(fm.owner, ['alice', 'bob'])
  assert.equal(fm.tags, '[audio, alsa]') // 인라인 형태는 기존대로 문자열
})

test('parseFrontmatter: 항목 없는 빈 블록 리스트는 빈 배열', () => {
  const fm = parseFrontmatter('---\nowner:\nmodule: x\n---\n')
  assert.deepEqual(fm.owner, [])
  assert.equal(fm.module, 'x')
})

test('listOf/primaryOf: 스칼라·배열·빈 값 정규화', () => {
  assert.deepEqual(listOf('alice'), ['alice'])
  assert.deepEqual(listOf(['a', 'b']), ['a', 'b'])
  assert.deepEqual(listOf(undefined), [])
  assert.equal(primaryOf(['a', 'b']), 'a')
  assert.equal(primaryOf('alice'), 'alice')
  assert.equal(primaryOf(undefined), null)
})
