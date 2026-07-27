// 분석 코멘트 전송 채널 — .env SVP_COMMENT_CHANNEL로 선택한다.
//   rest(기본) → jira.mjs postComment (Jira REST 직접)
//   mcp        → 사내 MCP 서버 경유 (미구현 — 세팅은 후속 작업, SVP_COMMENT_MCP_URL)
// mcp가 아직 구현/설정 전이어도 코멘트 기능이 죽지 않도록 REST로 폴백한다.
import { postComment } from './jira.mjs'

const CHANNEL = process.env.SVP_COMMENT_CHANNEL ?? 'rest'
const MCP_URL = process.env.SVP_COMMENT_MCP_URL

/** Startup-log label: which channel analysis comments go through. */
export function commentChannel() {
  return CHANNEL === 'mcp' ? `mcp(${MCP_URL ?? '미설정'})` : 'rest'
}

export async function postAnalysisComment(key, body) {
  if (CHANNEL === 'mcp') {
    // TODO(SVP-?): MCP 서버로 코멘트 전송 — MCP 세팅 확정 후 구현 (지금은 REST 폴백).
    console.warn(`[svp-server] comment-channel mcp 미구현 — ${key} 코멘트는 REST로 전송`)
  }
  return postComment(key, body)
}
