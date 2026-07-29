// Shared helpers for the Agent Portal's Team Chat (team channel + DMs).
// Storage: one JSON array blob per conversation in the "chat" Blobs store.
//   - team channel key:  "team"
//   - DM key:            "dm:" + [emailA, emailB] sorted + joined with "|"
//
// Permission model:
//   - Everyone can read/post in the "team" channel.
//   - A "lead" (team lead / master login) can DM any agent.
//   - A regular "agent" can only DM a lead (reply to/initiate with leadership),
//     not other regular agents directly — matches "give the team lead
//     permission to message anyone personally" as the distinguishing power.
const { loadAgents } = require('./_agent-auth');

function findAgentByEmail(email) {
  const agents = loadAgents() || [];
  return agents.find(a => String(a.email || '').toLowerCase() === String(email || '').toLowerCase()) || null;
}

function conversationKey(selfEmail, channel) {
  if (channel === 'team') return 'team';
  const pair = [String(selfEmail).toLowerCase(), String(channel).toLowerCase()].sort();
  return `dm:${pair.join('|')}`;
}

// Returns { allowed: boolean, reason?: string }
function canAccessChannel(selfAgent, channel) {
  if (channel === 'team') return { allowed: true };

  const targetAgent = findAgentByEmail(channel);
  if (!targetAgent) return { allowed: false, reason: 'That agent does not exist.' };
  if (String(targetAgent.email).toLowerCase() === String(selfAgent.email).toLowerCase()) {
    return { allowed: false, reason: "You can't message yourself." };
  }
  if (selfAgent.role === 'lead') return { allowed: true };
  if (targetAgent.role === 'lead') return { allowed: true };
  return { allowed: false, reason: 'Agents can only direct-message a team lead — use Team Chat to reach other agents.' };
}

module.exports = { findAgentByEmail, conversationKey, canAccessChannel };
