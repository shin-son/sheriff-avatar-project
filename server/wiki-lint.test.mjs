// 제안 4 Phase 1 — 서버 lint 순수 함수 테스트 (고아 재설계 + 피드백 정리 후보 + 헬스 스코어).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findOrphans, healthScore, lintVault } from './wiki-lint.mjs'

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
  const notes = [
    { file: 'modules/auth.md', title: 'auth 모듈', body: '# auth 모듈' },
    { file: 'case-log.md', title: 'case-log.md', body: '- module: auth' },
    { file: 'modules/payment.md', title: 'payment 모듈', body: '# payment 모듈' }
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

test('lintVault: 피드백이 threshold 미만이거나 일치가 더 많으면 후보가 아니다', () => {
  const notes = [
    { file: 'modules/auth.md', title: 'auth 모듈', body: '# auth 모듈 [[payment]]' },
    { file: 'modules/payment.md', title: 'payment 모듈', body: 'auth 참고' }
  ]
  const feedback = { 'auth 모듈': { up: 0, down: 2 }, 'payment 모듈': { up: 4, down: 3 } }
  const r = lintVault({ notes, feedback, generatedAt: '2026-07-30T00:00:00Z' })
  assert.deepEqual(r.unhelpfulNotes, [])
  assert.equal(r.healthScore, 100)
})
