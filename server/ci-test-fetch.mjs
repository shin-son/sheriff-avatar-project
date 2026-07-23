// Skill-based CI test log fetch — poll()의 Jenkins 로그 보강 1차 경로.
// headless Claude(`claude -p "/fetch-ci-log ..."`)가 .claude/skills/fetch-ci-log
// 스킬을 실행한다: fetch_ci_test.py로 raw 로그를 받아 지정 양식으로 재조합해
// stdout으로 준다. 실패(claude CLI 없음·타임아웃·FETCH_FAILED) 시 null —
// 호출부(index.mjs)가 기존 jenkins.mjs fetchFailureLog로 폴백한다.
//
// Windows 개발 환경 주의: claude CLI가 PATH의 네이티브 exe여야 한다 (npm
// .cmd shim은 shell 없이 spawn되지 않음). 운영(Linux systemd)은 해당 없음.

import { execFile } from 'node:child_process'

const MATCH = 'Test Result: FAIL'
// 스킬 한 번 = claude 세션 한 번 — Jenkins 직통보다 느리다. 여유를 둔다.
const TIMEOUT_MS = 180_000

/**
 * Failure log via the fetch-ci-log skill → { url, log } or null. Never
 * throws — 스킬 경로가 죽어도 poll 루프와 기존 폴백은 살아야 한다.
 */
export function fetchFailureLogViaSkill(buildUrl, tc) {
  const prompt = `/fetch-ci-log ${buildUrl} ${tc ?? '-'} "${MATCH}"`
  return new Promise((resolve) => {
    execFile(
      'claude',
      ['-p', prompt, '--allowedTools', 'Bash(python3:*)'],
      { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        const out = (stdout ?? '').trim()
        if (err || out === '' || out.startsWith('FETCH_FAILED')) {
          const reason = err ? err.message : out || 'empty output'
          console.error(`[svp-server] fetch-ci-log skill failed ${buildUrl}: ${reason}`)
          return resolve(null)
        }
        resolve({ url: buildUrl, log: out })
      }
    )
  })
}
