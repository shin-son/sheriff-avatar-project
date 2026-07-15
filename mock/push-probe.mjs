// Dev probe for the v3 push server — logs in as a user and prints pushed frames.
// Lets extra terminals impersonate users (admin / shin.son / ...) to verify
// login auth, server-side filtering, and assignee/status sync without
// installing the app twice. Demo auth: password must equal the username.
// Usage: node mock/push-probe.mjs <username> <durationMs> [--ack]
import { io } from 'socket.io-client'

const username = process.argv[2] ?? 'shin.son'
const durationMs = Number(process.argv[3] ?? 60000)
const autoAck = process.argv.includes('--ack')
const socket = io('http://localhost:8793', { auth: { username, password: username } })

socket.on('connect_error', (e) => console.log(`[${username}] connect_error: ${e.message}`))
socket.on('session', (s) =>
  console.log(`[${username}] session: role=${s.user.role}, team=${s.team.map((m) => m.id).join('/')}`)
)
for (const ev of ['issue:new', 'issue:updated']) {
  socket.on(ev, (i) => {
    console.log(
      `[${username}] ${ev}: ${i.event.jira.key} status=${i.status} assignee=${i.assignment.assigneeId} "${i.event.title}"`
    )
    if (autoAck && ev === 'issue:new' && i.status === 'new') {
      socket.emit('issue:ack', { issueId: i.event.id })
      console.log(`[${username}] → issue:ack ${i.event.id}`)
    }
  })
}
setTimeout(() => process.exit(0), durationMs)
