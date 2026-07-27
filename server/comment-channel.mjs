// 분석 코멘트 전송 채널 — .env SVP_COMMENT_CHANNEL로 선택한다.
//   rest(기본) → jira.mjs postComment (Jira REST 직접)
//   mcp        → headless claude(`claude -p`)가 SVP_COMMENT_MCP_NAME으로 등록된
//                MCP 서버의 Jira 툴을 호출해 기입. MCP 접속 정보는 서버 호스트의
//                claude MCP 설정(json)에 이미 있다 — 여기서는 이름만 쓴다.
// 이름 미설정·호출 실패 시 REST로 폴백해 코멘트가 유실되지 않게 한다.
// (폴백의 드문 엣지: claude가 기입엔 성공하고 OK 출력만 실패하면 중복 코멘트 가능)
//
// Windows 개발 환경 주의: claude CLI가 PATH의 네이티브 exe여야 한다 (ci-test-fetch.mjs
// 참고). 운영(Linux systemd)은 해당 없음.
import { execFile } from 'node:child_process'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { postComment } from './jira.mjs'

const CHANNEL = process.env.SVP_COMMENT_CHANNEL ?? 'rest'
const MCP_NAME = process.env.SVP_COMMENT_MCP_NAME
// MCP 기입 한 번 = claude 세션 한 번 — 여유를 둔다.
const MCP_TIMEOUT_MS = 120_000

/** Startup-log label: which channel analysis comments go through. */
export function commentChannel() {
  return CHANNEL === 'mcp' ? `mcp(${MCP_NAME ?? '이름 미설정 — REST 폴백'})` : 'rest'
}

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout ?? '').trim(), errOut: (stderr ?? '').trim(), err })
    })
  })
}

// 코멘트 본문이 길어서 임시 파일로 전달한다. classifyAndAct는 티켓별로 동시에
// 돌 수 있으므로 파일명에 key를 넣어 충돌을 막는다.
async function postViaMcp(key, body) {
  const file = join(tmpdir(), `svp-comment-${process.pid}-${key}.txt`)
  try {
    await writeFile(file, body)
    const prompt = `${MCP_NAME} MCP의 Jira 툴로 티켓 ${key}에 코멘트를 하나 달아라. 코멘트 본문은 파일 ${file}의 내용 그대로 쓴다 (수정·요약 금지). 성공하면 "OK"만, 실패하면 "MCP_FAILED: <이유>"만 출력해라.`
    console.log(`[svp-server] comment ${key}: mcp 호출 — claude -p --allowedTools Read,mcp__${MCP_NAME}`)
    const { ok, out, errOut, err } = await run(
      'claude',
      ['-p', prompt, '--allowedTools', `Read,mcp__${MCP_NAME}`, '--add-dir', tmpdir()],
      MCP_TIMEOUT_MS
    )
    if (!ok || !out.startsWith('OK')) {
      // exit code·stdout(MCP_FAILED 사유)·stderr를 전부 실어야 원인이 보인다
      // (systemd에서 claude 미설치/PATH 문제는 err, MCP 미등록은 stdout에 나타남).
      const parts = [err?.message, out && `stdout: ${out.slice(0, 300)}`, errOut && `stderr: ${errOut.slice(0, 300)}`]
      throw new Error(parts.filter(Boolean).join(' | ') || 'empty output')
    }
  } finally {
    rm(file, { force: true }).catch(() => {})
  }
}

export async function postAnalysisComment(key, body) {
  if (CHANNEL === 'mcp') {
    if (!MCP_NAME) {
      console.warn(`[svp-server] SVP_COMMENT_MCP_NAME 미설정 — ${key} 코멘트는 REST로 전송`)
    } else {
      try {
        await postViaMcp(key, body)
        console.log(`[svp-server] comment ${key}: mcp 기입 성공`)
        return
      } catch (err) {
        console.error(`[svp-server] comment ${key}: mcp 실패 — REST 폴백 (${err.message})`)
      }
    }
  }
  console.log(`[svp-server] comment ${key}: REST POST /rest/api/2/issue/${key}/comment (${body.length} chars)`)
  await postComment(key, body)
  console.log(`[svp-server] comment ${key}: REST 기입 성공`)
}
