---
name: fetch-ci-log
description: fetch_ci_test.py로 CI_TEST 실패 로그를 받아 지정 양식으로 재조합해 stdout으로 출력한다. server poll 루프가 headless(claude -p)로 호출하므로 최종 응답은 재조합 결과만 담아야 한다.
---

# fetch-ci-log

CI 티켓의 Jenkins 빌드 URL에서 `fetch_ci_test.py`로 실패 로그 raw text를 받아,
아래 "출력 양식"으로 재조합해 출력하는 스킬. 호출자는 사람이 아니라
`server/ci-test-fetch.mjs`(headless `claude -p`)다 — **stdout이 곧 API 응답**이다.

## 인자

`$ARGUMENTS` = `<buildUrl> <tc> <match...>`

- `buildUrl` — 티켓 TEST 링크의 Jenkins 빌드 URL
- `tc` — 티켓의 `TC name or file` 값. 알 수 없으면 `-`가 온다
- `match` — 전후 문맥의 기준 문자열 (따옴표 포함 가능, 나머지 토큰 전부). 예: `"Test Result: FAIL"`

## 절차

1. 인자를 파싱한다: 첫 토큰 = `buildUrl`, 둘째 토큰 = `tc`, 나머지 전체 = `match`
   (감싼 따옴표는 제거).
2. repo 루트에서 툴을 실행하고 stdout(raw text)을 캡처한다:

   ```bash
   python3 fetch_ci_test.py "<buildUrl>" "<tc>" "<match>"
   ```

   툴은 `buildUrl`에서 CI_TEST 링크를 찾아 로그를 가져오고, `match` 문자열
   기준 전후 내용을 콘솔로 출력한다.
3. raw text를 아래 **출력 양식**으로 재조합한다.
4. 최종 응답은 **재조합 결과만** 출력한다 — 설명·인사·마크다운 코드펜스 금지.
   서버가 stdout을 그대로 `event.log`에 덧붙인다.

## 출력 양식

<!-- TODO(SVP): 양식은 추후 지정 — 지정되면 이 섹션만 교체한다. -->
양식이 지정되기 전까지는 passthrough: 첫 줄에 `[ci-test log] <buildUrl>`,
이어서 raw text를 가공 없이 그대로 출력한다.

## 실패 처리

툴이 없거나(파일 미존재), 비정상 종료하거나, 출력이 비어 있으면 최종 응답을
정확히 한 줄로 출력한다:

```
FETCH_FAILED: <한 줄 사유>
```

서버는 이 접두사(또는 빈 출력)를 실패로 간주하고 기존 jenkins.mjs 경로로
폴백한다. 재시도하거나 다른 방법을 시도하지 않는다.
