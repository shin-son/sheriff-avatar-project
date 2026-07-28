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

// claude CLI는 있으나 /format-ci-log 스킬이 없는 환경(스킬 미포함 clean checkout)
// 에서는 exit 0 + "Unknown command: /format-ci-log" 같은 짧은 에러/대화 출력을 낸다.
// 이게 정상 결과로 오인돼 raw 로그를 덮어쓰면 분류 입력이 오염된다. 아래 시그니처·
// 하한으로 걸러낸다 — 거부되면 호출부가 raw 로그를 그대로 쓰므로 과다 거부는 안전하다.
const FORMAT_ERROR_SIGNATURES =
  /unknown command|no such command|command not found|not a recognized|do(n't| not) (have|recognize|know)/i
// 실제 양식화된 실패 로그는 이보다 훨씬 길다. 짧은 출력은 에러/거부로 간주.
const MIN_FORMATTED_LEN = 200

/**
 * 스킬 출력이 raw 로그를 대체할 만한 "진짜 양식화 결과"인지 판정 (화이트리스트).
 * exit 실패·빈 출력·FORMAT_FAILED sentinel·에러 시그니처·비현실적으로 짧은 출력을
 * 모두 거부한다. 거부 시 호출부는 raw 로그를 그대로 사용한다.
 */
export function isFormattedLog(ok, out) {
  return (
    ok &&
    out !== '' &&
    !out.startsWith('FORMAT_FAILED') &&
    out.length >= MIN_FORMATTED_LEN &&
    !FORMAT_ERROR_SIGNATURES.test(out)
  )
}

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
    if (!isFormattedLog(ok, out)) {
      const reason = err ? err.message : out || 'empty output'
      console.error(`[svp-server] format-ci-log skill failed (raw 로그 사용): ${reason.slice(0, 120)}`)
      return null
    }
    return out
  } finally {
    rm(file, { force: true }).catch(() => {})
  }
}
