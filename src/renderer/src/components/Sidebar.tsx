import type { TeamMember, UserConfig, WsStatus } from '@shared/types'

const WS_LABEL: Record<WsStatus, string> = {
  connected: 'CI/CD 연결됨',
  connecting: '연결 중…',
  disconnected: '연결 끊김 — 재시도 중'
}

interface Props {
  team: TeamMember[]
  user: UserConfig
  wsStatus: WsStatus
  muted: boolean
  onToggleMuted: () => void
}

export default function Sidebar({ team, user, wsStatus, muted, onToggleMuted }: Props) {
  const me = team.find((m) => m.id === user.userId)
  return (
    <aside className="sidebar">
      <div className="me-card">
        <span className="avatar avatar-lg">{me?.name.charAt(0)}</span>
        <div className="me-info">
          <div className="me-name">{me?.name}</div>
          <span className={`role-badge ${user.role}`}>
            {user.role === 'sheriff' ? '당번 · SHERIFF' : '팀원 · MEMBER'}
          </span>
        </div>
      </div>

      {/* 로그인이 신원을 결정한다 (v3) — 명단은 표시만, 전환 없음 */}
      <div className="section-title">팀</div>
      <div className="team-list">
        {team.map((m) => (
          <div key={m.id} className={`team-item ${m.id === user.userId ? 'active' : ''}`}>
            <span className="avatar">{m.name.charAt(0)}</span>
            <span className="team-item-body">
              <span className="team-name">
                {m.name}
                {m.role === 'sheriff' && <span className="mini-star" aria-hidden="true" />}
              </span>
              <span className="team-mods">{m.ownedModules.join(' · ')}</span>
            </span>
          </div>
        ))}
      </div>

      <button
        className={`notify-toggle ${muted ? 'off' : ''}`}
        title={muted ? '알림 팝업 다시 켜기' : '알림 팝업 끄기 (이슈는 목록에 계속 쌓임)'}
        onClick={onToggleMuted}
      >
        <span className="dot" /> {muted ? '알림 꺼짐' : '알림 켜짐'}
      </button>
      <div className={`ws-status ${wsStatus}`}>
        <span className="dot" /> {WS_LABEL[wsStatus]}
      </div>
    </aside>
  )
}
