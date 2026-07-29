// Shared helper for the Agent Portal's per-agent login.
//
// Configure via the AGENT_ACCOUNTS environment variable — a JSON array,
// one entry per agent, e.g.:
//   [
//     {"name":"Leo","email":"leo@mytravelroyalties.com","code":"FYWA-C36T","role":"agent"},
//     {"name":"Gaman","email":"gaman@mytravelroyalties.com","code":"YRJU-VXM4","role":"lead"}
//   ]
//
// role is "agent" (can create/view their own quotes) or "lead" (can also see
// every agent's quotes via agent-quotes.js). Codes live only in this env
// variable — never in source, never in git.
function loadAgents() {
  const raw = process.env.AGENT_ACCOUNTS;
  if (!raw) return null; // not configured yet — callers should fail closed
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('AGENT_ACCOUNTS is not valid JSON:', e.message);
    return [];
  }
}

// Validates an email+code pair. Returns:
//   { configured: false }                        — AGENT_ACCOUNTS isn't set
//   { configured: true, agent: null }             — set, but no match (bad login)
//   { configured: true, agent: {name,email,role} } — valid login
function findAgent(email, code) {
  const agents = loadAgents();
  if (agents === null) return { configured: false };
  const match = agents.find(a =>
    String(a.email || '').toLowerCase() === String(email || '').toLowerCase() &&
    String(a.code || '') !== '' &&
    String(a.code || '') === String(code || '')
  );
  if (!match) return { configured: true, agent: null };
  return { configured: true, agent: { name: match.name || match.email, email: match.email, role: match.role === 'lead' ? 'lead' : 'agent' } };
}

module.exports = { findAgent, loadAgents };
