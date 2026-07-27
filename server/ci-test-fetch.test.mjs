// isFormattedLog 회귀 테스트 — 스킬 출력이 raw 로그를 덮어쓸 자격이 있는지 판정.
// 재현 버그: claude CLI는 있으나 /format-ci-log 스킬이 없는 clean checkout에서
// exit 0 + "Unknown command: /format-ci-log"가 정상 결과로 오인돼 실패 로그를
// 오염시키고 issue-cache.json에 영구 저장되던 문제.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFormattedLog } from './ci-test-fetch.mjs'

const realLog = `Test Result: FAIL\n${'x'.repeat(300)}` // 실제 양식화 로그 (충분히 김)

test('exit 0 + "Unknown command" 출력은 거부한다 (재현 버그)', () => {
  assert.equal(isFormattedLog(true, 'Unknown command: /format-ci-log'), false)
})

test('스킬 미설치 대화형 거부 응답도 거부한다', () => {
  assert.equal(isFormattedLog(true, "I don't have a command called /format-ci-log."), false)
  assert.equal(isFormattedLog(true, 'No such command: /format-ci-log'), false)
})

test('빈 출력·FORMAT_FAILED sentinel·비정상 종료는 거부한다', () => {
  assert.equal(isFormattedLog(true, ''), false)
  assert.equal(isFormattedLog(true, 'FORMAT_FAILED: could not read file'), false)
  assert.equal(isFormattedLog(false, realLog), false)
})

test('비현실적으로 짧은 출력은 거부한다', () => {
  assert.equal(isFormattedLog(true, 'Test Result: FAIL (ok)'), false)
})

test('충분히 길고 에러 시그니처 없는 실제 양식화 로그는 수용한다', () => {
  assert.equal(isFormattedLog(true, realLog), true)
})
