// Mock Jenkins — the minimal read-only subset server/jenkins.mjs uses:
// build console text, plus the api/json probes used in the 사내 검증 절차
// (docs/SETUP.md). mock/jira-server.mjs seeds point their ci-url here
// (http://localhost:8794/job/ci-<module>/<seq>/).
// Usage: npm run mock:jenkins  (port 8794)
import { createServer } from 'node:http'

const PORT = 8794

// TC별 실패 구간 — jira mock 시나리오의 TC와 짝 (마커는 실콘솔처럼 `linux.`
// 접두사 없이 찍힌다). 실패 정보는 구간 초반, 뒤는 진단 노이즈 — 구간 추출
// 로직이 "노이즈 속 실패 구간"을 정확히 잘라오는지 검증하기 위한 구조다.
const TC_FAILS = {
  auth: {
    'auth-token-refresh-088.sh': [
      'SITL-088',
      'Test Result: FAIL',
      'Fail Log: expected status 200 but got 401 (invalid_grant: Token is not active)',
      '  at LoginFlowTest.test_token_refresh (auth/tests/login_flow.py:88)',
      'hint: keycloak dev realm의 refresh token lifetime이 0으로 초기화된 상태에서 재현됨'
    ],
    'auth-session-lint-057.sh': [
      'Test Result: FAIL',
      'Fail Log: auth/session.ts:57:3  error  Promises must be awaited  @typescript-eslint/no-floating-promises'
    ]
  },
  payment: {
    'payment-refund-e2e-030.sh': [
      'SITL-030',
      'Test Result: FAIL',
      'Fail Log: TimeoutError: waiting for selector "#refund-done" failed: timeout 30000ms exceeded'
    ],
    'payment/checkout.cc': [
      'Test Result: FAIL',
      'Fail Log: ld.lld: error: undefined symbol: BillingClient::retry()',
      '>>> referenced by checkout.cc:412 (../../payment/checkout.cc:412)'
    ]
  },
  'renderer-core': {
    // 콘솔 마커에는 티켓 TC명(python.ui-...py)에 없는 I- 접두사가 붙는다 (사내 실측 변형)
    'I-ui-snapshot-diff-041.py': [
      'SITL-041',
      'Test Result: FAIL',
      'Fail Log: Snapshot mismatch: 3 pixels differ (threshold 0) at ui/tests/snapshot.spec.ts:41'
    ]
  },
  infra: {
    'infra-staging-deploy-005.sh': [
      'Test Result: FAIL',
      'Fail Log: UPGRADE FAILED: timed out waiting for the condition (release: svp-staging)'
    ]
  }
}

const DIAG_NOISE = [
  'CHECK BOOT STATUS',
  'root@mock:/tmp# dmesg | tail -100',
  ...Array.from({ length: 30 }, (_, i) => `[ 4064.70${i}][   T28] [ACPM_FW] : id:0, irq_num, ${i}`)
]

// 실사내 2단 구조를 재현한다: 티켓이 가리키는 ci-<module>(=CI_MAIN_JOB 역할)
// 빌드의 CI TEST RESULT 링크는 콘솔이 아니라 build description(api/json)에
// 있다 (사내 확인). 실패 로그는 링크된 CI_TEST_<module> 샤드 콘솔에 있다
// (CI_TEST_pass는 성공 샤드 — result 필터링 검증용).
function descriptionFor(job, num) {
  if (!job.startsWith('ci-')) return null
  const module = job.slice(3)
  return [
    'CI_MAIN_JOB Resource: n132_mock_res',
    'CI_MAIN_JOB Resource: n131_mock_res',
    `CI TEST RESULT : http://localhost:${PORT}/job/CI_TEST_pass/${num}/`,
    `- CI TEST REPORT URL : http://localhost:${PORT}/ci/tc/reportUrl/${num}`,
    `CI TEST RESULT : http://localhost:${PORT}/job/CI_TEST_${module}/${num}/`,
    `- CI TEST REPORT URL : http://localhost:${PORT}/ci/tc/reportUrl/${num}`
  ].join('\n')
}

function consoleFor(job, num) {
  if (job.startsWith('ci-')) {
    return ['Started by timer', 'Triggering CI_TEST shards...', 'Finished: FAILURE'].join('\n')
  }
  if (job === 'CI_TEST_pass') {
    return ['+ run test shard on n132_mock_res', 'All 42 tests passed', 'Finished: SUCCESS'].join('\n')
  }
  // 실패 샤드: 실콘솔처럼 여러 TC가 [ENABLE] 마커로 직렬 실행되는 큰 콘솔.
  const module = job.replace(/^CI_TEST_/, '')
  const sections = TC_FAILS[module] ?? { 'unknown-tc-000.sh': ['Test Result: FAIL', 'Fail Log: (원인 미상)'] }
  const lines = [
    `Started by upstream project "CI_MAIN_JOB" build number ${num}`,
    'Running on n131_mock_res in /var/jenkins_home/workspace/CI_TEST',
    '[ENABLE] [11 /86] boot-sanity-001.sh',
    '=======================================================',
    'Test Result: PASS'
  ]
  let i = 12
  for (const [tc, fail] of Object.entries(sections)) {
    lines.push(`[ENABLE] [${i} /86] ${tc}`, '=======================================================', ...fail, ...DIAG_NOISE)
    i += 1
  }
  lines.push(
    `[ENABLE] [${i} /86] boot-sanity-002.sh`,
    '=======================================================',
    'Test Result: PASS',
    'ERROR: TEST Failure',
    'Finished: FAILURE'
  )
  return lines.join('\n')
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const build = url.pathname.match(/^\/job\/([^/]+)\/(\d+)\/(consoleText|api\/json)$/)

  if (req.method === 'GET' && url.pathname === '/api/json') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ jobs: Object.keys(TAILS).map((m) => ({ name: `ci-${m}` })) }))
  }

  if (req.method === 'GET' && build) {
    const [, job, num, sub] = build
    if (sub === 'consoleText') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      console.log(`[mock-jenkins] consoleText ${job} #${num}`)
      return res.end(consoleFor(job, num))
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(
      JSON.stringify({
        fullDisplayName: `${job} #${num}`,
        number: Number(num),
        description: descriptionFor(job, num),
        result: job === 'CI_TEST_pass' ? 'SUCCESS' : 'FAILURE'
      })
    )
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, () => {
  console.log(`[mock-jenkins] listening on http://localhost:${PORT}`)
  console.log(`[mock-jenkins] probe: curl localhost:${PORT}/job/ci-auth/1001/consoleText`)
})
