// CI test log 확보·양식화 — poll()의 Jenkins 로그 보강 경로.
// 1) fetchRawLogViaTool: fetch_ci_test.py(.tool/Jenkins/)를 직접 실행해 raw 로그 확보.
//    실패 시 null — 호출부(index.mjs)가 기존 jenkins.mjs fetchFailureLog로 폴백.
// 2) formatLogViaSkill: 확보한 로그를 임시 파일로 넘겨 headless Claude
//    (`claude -p "/format-ci-log <file>"`)의 format-ci-log 스킬로 양식화.
//    실패(claude CLI 없음·타임아웃·FORMAT_FAILED) 시 null — raw 로그 그대로 사용.
//
// Windows 개발 환경 주의: claude CLI가 PATH의 네이티브 exe여야 한다 (npm
// .cmd shim은 shell 없이 spawn되지 않음). 운영(Linux systemd)은 해당 없음.

import { execFile } from 'node:child_process'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MATCH = 'Test Result: FAIL'
const TOOL_TIMEOUT_MS = 60_000
// 양식화 한 번 = claude 세션 한 번 — 여유를 둔다.
const SKILL_TIMEOUT_MS = 180_000
const MAX_BUFFER = 16 * 1024 * 1024

/** execFile → { ok, out }. Never throws — 실패는 호출부 폴백으로 이어진다. */
function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: MAX_BUFFER }, (err, stdout) => {
      resolve({ ok: !err, out: (stdout ?? '').trim(), err })
    })
  })
}

/**
 * Raw failure log via fetch_ci_test.py → text or null. 툴은 buildUrl에서
 * CI_TEST 링크를 찾아 로그를 가져오고 MATCH 문자열 전후 내용을 stdout으로 준다.
 */
export async function fetchRawLogViaTool(buildUrl, tc) {
  const { ok, out, err } = await run(
    'python3',
    ['.tool/Jenkins/fetch_ci_test.py', buildUrl, tc ?? '-', MATCH],
    TOOL_TIMEOUT_MS
  )
  if (!ok || out === '') {
    console.error(`[svp-server] fetch_ci_test.py failed ${buildUrl}: ${err ? err.message : 'empty output'}`)
    return null
  }
  return out
}

/**
 * 확보한 로그를 format-ci-log 스킬로 양식화 → text or null. 로그가 커서
 * 임시 파일로 전달한다 (poll은 single-flight — 파일 재사용 안전).
 */
export async function formatLogViaSkill(log) {
  const file = join(tmpdir(), `svp-ci-log-${process.pid}.txt`)
  try {
    await writeFile(file, log)
    const { ok, out, err } = await run(
      'claude',
      ['-p', `/format-ci-log ${file}`, '--allowedTools', 'Read', '--add-dir', tmpdir()],
      SKILL_TIMEOUT_MS
    )
    if (!ok || out === '' || out.startsWith('FORMAT_FAILED')) {
      const reason = err ? err.message : out || 'empty output'
      console.error(`[svp-server] format-ci-log skill failed: ${reason}`)
      return null
    }
    return out
  } finally {
    rm(file, { force: true }).catch(() => {})
  }
}
