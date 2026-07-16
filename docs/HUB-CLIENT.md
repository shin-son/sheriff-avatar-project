# hub-client — 서버(hub) 개발자를 위한 클라이언트 통신 명세

> **⚠️ DEPRECATED (2026-07-15 회의)** — 전송 계층이 Socket.IO로 확정되면서 hub/hub-client(raw WS)는
> 더 이상 앱에서 기동하지 않는다. 현행 계약은 [API.md §1](./API.md)의 Socket.IO 절
> (`session`/`issue:new`/`issue:updated`/`issue:ack`). 이 문서는 hub 모듈 정리 PR에서 코드와 함께 삭제 예정.

> 프로토콜 계약의 원본은 [API.md §1](./API.md)이다. 이 문서는 **클라이언트(`src/main/modules/hub-client/`)가
> 실제로 구현한 동작**을 서버(`modules/hub/`, F6) 구현자 관점에서 기술한다.
> 메시지 타입 정의는 `src/shared/types.ts`(`HubMessage`, `Hub*Payload`)에 있고, 서버도 같은 타입을 사용한다.

## 접속

- 클라이언트는 `SVP_SERVER_URL`(기본 `ws://localhost:8791`)로 접속한다. role=member일 때만 동작하며,
  role=sheriff는 hub-client를 쓰지 않는다 (당번 대시보드는 같은 프로세스 IPC).
- 연결이 끊기면 **3초 간격으로 무한 재접속**하고, 성공할 때마다 `client:hello`를 다시 보낸다.
- 앱 안에서 사용자를 전환하면 클라이언트가 **연결을 끊고 새 `clientId`로 재접속**한다.
  같은 소켓에서 hello가 두 번 오는 경우는 없다.
- 하트비트: 클라이언트는 별도 코드가 없다. `ws` 라이브러리가 표준 ping에 자동 pong 응답하므로
  서버 주도 ping/pong(30초, 2회 무응답 시 종료)이 그대로 동작한다.

## Envelope

모든 프레임은 JSON 텍스트 하나. 클라이언트가 보내는 `v`는 항상 `1`, `ts`는 ISO 8601.

```json
{ "v": 1, "type": "client:hello", "ts": "2026-07-14T06:21:20.825Z", "payload": { "clientId": "alice", "appVersion": "0.1.0" } }
```

위는 실측 프레임 그대로다. `clientId`는 `TeamMember.id`(예: `alice`), `appVersion`은 `app.getVersion()`.

## 클라이언트 → 서버

| type | 시점 | 비고 |
|---|---|---|
| `client:hello` | 소켓 open 직후 1회 | **Week 1 기준 클라이언트가 보내는 유일한 메시지.** `issue:ack`, `wiki:feedback`은 Week 2에 추가 예정 |

## 서버 → 클라이언트: 수신 처리 방식

| type | 클라이언트 동작 | 서버가 알아야 할 것 |
|---|---|---|
| `server:welcome` | 로컬 issues/team을 payload로 **전체 교체** 후 화면 갱신 | 누적이 아니라 교체다. **미해결 배정분 전체**를 담아야 오프라인 중 배정이 복원된다. 재접속 hello마다 다시 보내야 함 |
| `issue:assigned` | 목록 맨 앞에 추가 + toast 팝업 | **클라이언트는 중복 제거를 하지 않는다.** 같은 이슈를 두 번 보내면 두 번 표시된다. 재접속 복원은 welcome으로만 할 것 |
| `issue:updated` | `event.id`가 같은 항목을 교체. **없으면 조용히 버린다** | 클라이언트가 모르는 이슈에 updated만 보내면 유실된다. 신규는 반드시 `issue:assigned`(또는 welcome)로 먼저 |
| `server:error` | 콘솔 로그만 (UI 표시는 Week 2 — TODO(SVP-7)) | `UNKNOWN_CLIENT` 후 서버가 연결을 끊으면 클라이언트는 3초마다 재접속을 계속 시도한다는 점 유의 |
| 그 외 모든 type | **무시** (에러 아님) | 전방 호환 — 새 메시지를 먼저 배포해도 구버전 클라이언트가 깨지지 않는다 |

- 재배정으로 이 클라이언트가 제외될 때도 `issue:updated`를 그대로 보내면 된다.
  클라이언트 화면이 `issue.assignment.assigneeId`로 필터링해 알아서 숨긴다.
- 메시지 순서: welcome 전에 push가 와도 클라이언트는 처리한다. 단, 이후 도착한 welcome이
  상태를 통째로 덮어쓰므로 **hello를 받으면 welcome부터 보내는 것**이 안전하다.
- JSON 파싱 불가 프레임은 로그만 남기고 버린다 (연결 유지).

## 서버 없이 클라이언트 확인하는 법

포트 8791에 hello→welcome→push 순서로 응답하는 임의 WS 서버를 띄우고
`svp-config.json`을 member로 두고 `npm run dev`. 검증된 시나리오:
welcome 스냅샷 복원, `issue:assigned`/`issue:updated` 화면 반영, 모르는 type 무시,
서버 재시작 후 3초 내 재접속 + hello 재전송.
