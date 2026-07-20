// Mock Jenkins — the minimal read-only subset server/jenkins.mjs uses:
// build console text, plus the api/json probes used in the 사내 검증 절차
// (docs/SETUP.md). mock/jira-server.mjs seeds point their ci-url here
// (http://localhost:8794/job/ci-<module>/<seq>/).
// Usage: npm run mock:jenkins  (port 8794)
import { createServer } from 'node:http'

const PORT = 8794

// Per-module failure tails — deliberately richer than the jira description log,
// so the "콘솔 로그가 티켓을 보강한다" 흐름이 분류 프롬프트에서 보인다.
const TAILS = {
  auth: [
    '+ pytest auth/tests -x -q',
    '..........F',
    'FAILED auth/tests/login_flow.py::LoginFlowTest::test_token_refresh',
    'AssertionError: expected status 200 but got 401',
    '  response body: {"error":"invalid_grant","error_description":"Token is not active"}',
    '  at LoginFlowTest.test_token_refresh (auth/tests/login_flow.py:88)',
    'hint: keycloak dev realm의 refresh token lifetime이 0으로 초기화된 상태에서 재현됨'
  ],
  payment: [
    '+ ninja -C out/release payment-service',
    '[312/314] LINK payment-service',
    'ld.lld: error: undefined symbol: BillingClient::retry()',
    '>>> referenced by checkout.cc:412 (../../payment/checkout.cc:412)',
    '>>>               out/release/obj/payment/checkout.o:(PaymentFlow::confirm())',
    'clang: error: linker command failed with exit code 1'
  ],
  'renderer-core': [
    '+ npx playwright test ui/tests/snapshot.spec.ts',
    'Snapshot mismatch: 3 pixels differ (threshold 0)',
    '  Expected: ui/tests/__snapshots__/dark-toolbar.png',
    '  Received: test-results/dark-toolbar-actual.png',
    '  at SnapshotTest.ui_diff (ui/tests/snapshot.spec.ts:41)'
  ],
  infra: [
    '+ helm upgrade --install svp-staging ./chart --wait --timeout 5m',
    'Error: UPGRADE FAILED: timed out waiting for the condition (release: svp-staging)',
    'kubectl get pods -n staging | tail -2:',
    '  svp-staging-api-7d9c4-xk2lp   0/1   ImagePullBackOff   0   5m'
  ]
}

function consoleFor(job, num) {
  const module = job.replace(/^ci-/, '')
  const tail = TAILS[module] ?? ['+ make ci', 'make: *** [ci] Error 1']
  return [
    `Started by upstream project "${job}" build number ${num}`,
    `Running on agent-7 in /var/lib/jenkins/workspace/${job}`,
    '[Pipeline] stage (Checkout)',
    '> git fetch --tags --force --progress -- origin +refs/heads/*:refs/remotes/origin/*',
    '[Pipeline] stage (Build & Test)',
    ...tail,
    '[Pipeline] End of Pipeline',
    'Finished: FAILURE'
  ].join('\n')
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
      JSON.stringify({ fullDisplayName: `${job} #${num}`, number: Number(num), result: 'FAILURE' })
    )
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, () => {
  console.log(`[mock-jenkins] listening on http://localhost:${PORT}`)
  console.log(`[mock-jenkins] probe: curl localhost:${PORT}/job/ci-auth/1001/consoleText`)
})
