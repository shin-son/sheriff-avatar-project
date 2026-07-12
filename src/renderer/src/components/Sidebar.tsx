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
  onSelectUser: (userId: string) => void
}

export default function Sidebar({ team, user, wsStatus, onSelectUser }: Props) {
  const me = team.find((m) => m.id === user.userId)
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-badge">🤠</span>
        <div>
          <div className="brand-name">Sheriff Avatar</div>
          <div className="brand-sub">SVP · LLM-WIKI Agent</div>
        </div>
      </div>

      <div className="me-card">
        <span className="avatar avatar-lg">{me?.name.charAt(0)}</span>
        <div className="me-info">
          <div className="me-name">{me?.name}</div>
          <span className={`role-badge ${user.role}`}>
            {user.role === 'sheriff' ? '⭐ 당번 (SHERIFF)' : '팀원 (MEMBER)'}
          </span>
        </div>
      </div>

      <div className="section-title">사용자 전환 (데모)</div>
      <div className="team-list">
        {team.map((m) => (
          <button
            key={m.id}
            className={`team-item ${m.id === user.userId ? 'active' : ''}`}
            onClick={() => onSelectUser(m.id)}
          >
            <span className="avatar">{m.name.charAt(0)}</span>
            <span className="team-name">{m.name}</span>
            {m.role === 'sheriff' && <span className="star">⭐</span>}
          </button>
        ))}
      </div>

      <div className="section-title">담당 모듈 (IP)</div>
      <div className="modules">
        {team.map((m) => (
          <div key={m.id} className="module-row">
            <span className="avatar avatar-sm">{m.name.charAt(0)}</span>
            <span className="module-chips">
              {m.ownedModules.map((mod) => (
                <span key={mod} className="chip">
                  {mod}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>

      <div className={`ws-status ${wsStatus}`}>
        <span className="dot" /> {WS_LABEL[wsStatus]}
      </div>
    </aside>
  )
}
