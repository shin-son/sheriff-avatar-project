// SVP-6 실티켓 description 계약 파싱 (server/ticket.mjs)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { htmlToText, normalize } from '../server/ticket.mjs'

const JIRA = 'https://jira.example.com'

function ticket(description, summary = 'linux.power-dtm-160.sh Failed') {
  return {
    key: 'KITT-1',
    fields: {
      summary,
      description,
      created: '2026-07-01T00:00:00.000Z',
      status: { statusCategory: { key: 'new' } }
    }
  }
}

// 사내 실측 형태: 줄바꿈 없는 HTML 한 덩어리
const HTML_DESC =
  "<h2>[DEV_CICD][idcevo_sop28_la_720][T49689] : python.sfi_eth_24303.py FAIL</h2><ul>" +
  '<li>CICD Project : idcevo_sop28_la_720</li><li>Step : TEST</li><li>Category : SPECIAL</li>' +
  '<li>TC name or file : python.sfi_eth_24303.py</li></ul><h2>Link</h2><ul>' +
  "<li>CICD : <a href='https://cicd.example.net:3090/detail?type=test-pipeline&amp;seq=49689'>" +
  'https://cicd.example.net:3090/detail?type=test-pipeline&amp;seq=49689</a></li>' +
  "<li>TEST : <a href='http://10.0.0.1:8100/job/CI_MAIN_JOB/171699'>http://10.0.0.1:8100/job/CI_MAIN_JOB/171699</a></li>" +
  '<li>IMAGE DIR : None</li><li>DUMP DIR : None</li></ul>'

test('htmlToText: 블록 태그를 줄로 복원하고 태그·엔티티를 걷어낸다', () => {
  const text = htmlToText(HTML_DESC)
  assert.ok(!text.includes('<'), 'HTML 태그가 남으면 안 된다')
  assert.ok(text.includes('Step : TEST'), '줄 단위 key-value가 복원되어야 한다')
  assert.ok(text.includes('&seq=49689'), '&amp;는 &로 디코드')
})

test('htmlToText: plain text는 그대로 통과한다', () => {
  const plain = 'CICD Project : x\nStep : TEST'
  assert.equal(htmlToText(plain), plain)
})

test('normalize: HTML description에서 계약 필드를 뽑는다', () => {
  const e = normalize(ticket(HTML_DESC), JIRA)
  assert.equal(e.type, 'test_failed')
  assert.equal(e.branch, 'idcevo_sop28_la_720')
  assert.equal(e.module, 'unknown') // LLM 분류 몫
  assert.ok(e.url.startsWith('https://cicd.example.net:3090/'), 'url은 CICD 대시보드 링크')
  assert.ok(e.log.includes('TC name or file : python.sfi_eth_24303.py'))
  assert.ok(!e.log.includes('<li>'))
})

test('normalize: Step → type 매핑 (BUILD/DEPLOY/LINT, 미지의 값은 test_failed)', () => {
  const step = (v) => normalize(ticket(`Step : ${v}`), JIRA).type
  assert.equal(step('BUILD'), 'build_failed')
  assert.equal(step('DEPLOY'), 'deploy_failed')
  assert.equal(step('LINT'), 'lint_failed')
  assert.equal(step('SOMETHING_NEW'), 'test_failed')
})

test('normalize: description 없음 → 안전한 기본값 + browse 링크 폴백', () => {
  const e = normalize(ticket(undefined), JIRA)
  assert.equal(e.type, 'test_failed')
  assert.equal(e.branch, '')
  assert.equal(e.url, `${JIRA}/browse/KITT-1`)
  assert.equal(e.jira.status, 'new')
})
