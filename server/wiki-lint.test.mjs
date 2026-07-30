// 제안 4 Phase 1 — 서버 lint 순수 함수 테스트 (고아 재설계 + 피드백 정리 후보 + 헬스 스코어).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findOrphans, gapIssues, healthScore, lintVault, schemaIssues } from './wiki-lint.mjs'

const note = (file, body) => ({ file, title: file, body })

test('findOrphans: 아무도 참조하지 않는 노트를 고아로 잡는다 (옛 index 자기참조로 0건이던 버그 재현)', () => {
  const notes = [
    note('modules/auth.md', '# auth 모듈'),
    note('modules/payment.md', '# payment 모듈'),
    note('case-log.md', '## CIOPS-1 — 실패\n- module: auth')
  ]
  // auth는 case-log이 참조 → 생존. payment는 어디에도 없음 → 고아.
  assert.deepEqual(findOrphans(notes), ['modules/payment.md'])
})

test('findOrphans: 단어 경계 매칭 — authorization 속의 auth는 참조가 아니다', () => {
  const notes = [
    note('modules/auth.md', '# auth 모듈'),
    note('modules/infra.md', 'authorization 서버 점검 절차')
  ]
  assert.ok(findOrphans(notes).includes('modules/auth.md'))
})

test('findOrphans: case-log은 참조 소스일 뿐 고아 판정 대상이 아니다', () => {
  const notes = [note('case-log.md', '## CIOPS-1 — 실패')]
  assert.deepEqual(findOrphans(notes), [])
})

test('healthScore: severity별 감점 합산, 0 미만으로 내려가지 않는다', () => {
  assert.equal(healthScore([]), 100)
  assert.equal(healthScore([{ severity: 'warn' }, { severity: 'info' }]), 87)
  assert.equal(healthScore(Array(12).fill({ severity: 'warn' })), 0)
})

test('lintVault: 부정 피드백 누적 노트는 warn 정리 후보, 고아는 info', () => {
  const valid = (m) => fm({ type: 'module', module: m, owner: 'alice', tags: '[x]', updated: '2026-07-30' })
  const notes = [
    { file: 'modules/auth.md', title: 'auth 모듈', body: valid('auth') },
    { file: 'case-log.md', title: 'case-log.md', body: '- module: auth' },
    { file: 'modules/payment.md', title: 'payment 모듈', body: valid('payment') }
  ]
  const feedback = { 'auth 모듈': { up: 0, down: 3 } }
  const r = lintVault({ notes, feedback, generatedAt: '2026-07-30T00:00:00Z' })

  assert.equal(r.noteCount, 2) // case-log 제외
  assert.deepEqual(r.unhelpfulNotes, ['auth 모듈'])
  assert.deepEqual(r.orphanNotes, ['modules/payment.md'])
  assert.deepEqual(
    r.issues.map((i) => i.severity),
    ['warn', 'info']
  )
  assert.equal(r.healthScore, 87)
  assert.equal(r.suggestions.length, 2)
})

const fm = (fields) =>
  ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', '', '# 노트'].join('\n')

test('schemaIssues: 필수 frontmatter 누락은 critical, module-파일명 불일치는 warn', () => {
  const notes = [
    note('modules/auth.md', fm({ type: 'module', module: 'auth', owner: 'alice', tags: '[login]', updated: '2026-07-30' })),
    note('modules/payment.md', fm({ type: 'module', module: 'payment' })), // owner·tags·updated 누락
    note('modules/infra.md', fm({ type: 'module', module: 'network', owner: 'bob', tags: '[dns]', updated: '2026-07-30' })),
    note('case-log.md', '## CIOPS-1') // modules/ 밖 — 검사 대상 아님
  ]
  const issues = schemaIssues(notes)
  assert.deepEqual(
    issues.map((i) => [i.severity, i.note]),
    [
      ['critical', 'modules/payment.md'],
      ['warn', 'modules/infra.md']
    ]
  )
  assert.match(issues[0].message, /owner, tags, updated/)
})

test('gapIssues: 노트 없는 카테고리의 티켓을 모듈별로 묶고, 특정 불가는 (미분류)로', () => {
  const tickets = [
    { key: 'CIOPS-1', module: 'unknown', category: 'auth' }, // 노트 있음 → 공백 아님
    { key: 'CIOPS-2', module: 'sensor', category: 'unknown' },
    { key: 'CIOPS-3', module: 'sensor', category: 'unknown' },
    { key: 'CIOPS-4', module: 'unknown', category: 'unknown' }
  ]
  const issues = gapIssues(tickets, new Set(['auth']))
  assert.deepEqual(
    issues.map((i) => [i.severity, i.note]),
    [
      ['warn', 'modules/sensor.md'],
      ['warn', '(미분류)']
    ]
  )
  assert.match(issues[0].message, /2건/)
})

test('lintVault: 스키마 critical과 공백 warn이 리포트·헬스 스코어에 반영된다', () => {
  const notes = [
    { file: 'modules/auth.md', title: 'auth 모듈', body: fm({ type: 'module', module: 'auth' }) }, // critical
    { file: 'case-log.md', title: 'case-log.md', body: '- module: auth' }
  ]
  const r = lintVault({
    notes,
    feedback: {},
    tickets: [{ key: 'CIOPS-9', module: 'sensor', category: 'unknown' }],
    generatedAt: '2026-07-30T00:00:00Z'
  })
  assert.deepEqual(
    r.issues.map((i) => i.severity),
    ['critical', 'warn'] // 스키마 누락 + sensor 공백 (auth는 case-log이 참조해 고아 아님)
  )
  assert.equal(r.healthScore, 75) // 100 - 15 - 10
})

test('lintVault: 피드백이 threshold 미만이거나 일치가 더 많으면 후보가 아니다', () => {
  const valid = (m) => fm({ type: 'module', module: m, owner: 'alice', tags: '[x]', updated: '2026-07-30' })
  const notes = [
    { file: 'modules/auth.md', title: 'auth 모듈', body: `${valid('auth')}\n[[payment]] 참고` },
    { file: 'modules/payment.md', title: 'payment 모듈', body: `${valid('payment')}\nauth 참고` }
  ]
  const feedback = { 'auth 모듈': { up: 0, down: 2 }, 'payment 모듈': { up: 4, down: 3 } }
  const r = lintVault({ notes, feedback, generatedAt: '2026-07-30T00:00:00Z' })
  assert.deepEqual(r.unhelpfulNotes, [])
  assert.equal(r.healthScore, 100)
})

test('schemaIssues: 블록 리스트 owner는 누락이 아니다 (audio.md 오탐 재현)', () => {
  const body =
    '---\ntype: module\nmodule: audio\nowner:\n  - alice\n  - bob\ntags: [audio]\nupdated: 2026-07-30\n---\n# audio 모듈'
  const issues = schemaIssues([note('modules/audio.md', body)])
  assert.deepEqual(issues, [])
})

test('schemaIssues: 항목 없는 빈 owner 블록 리스트는 누락으로 잡는다', () => {
  const body = '---\ntype: module\nmodule: audio\nowner:\ntags: [audio]\nupdated: 2026-07-30\n---\n# audio'
  const issues = schemaIssues([note('modules/audio.md', body)])
  assert.equal(issues.length, 1)
  assert.ok(issues[0].message.includes('owner'))
})
