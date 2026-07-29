// POST /.netlify/functions/exec-metrics
// Body: { email, code }
// Executive dashboard: all agent data, performance charts, ARPC trends, chat monitoring
const { getStore, connectLambda } = require('@netlify/blobs');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');
const { findAgent, loadAgents } = require('./_agent-auth');

const WORKING_DAYS_PER_MONTH = 22;
const QUOTAS = {
  'leo@mytravelroyalties.com': 8000,
  'ben@mytravelroyalties.com': 8000,
  'luke@mytravelroyalties.com': 8000,
  'shikhar@mytravelroyalties.com': 10000,
  'gaman@mytravelroyalties.com': 10000,
};

function getMonthlyTarget(email) {
  return QUOTAS[email.toLowerCase()] || 8000;
}

function getDailyTarget(email) {
  return getMonthlyTarget(email) / WORKING_DAYS_PER_MONTH;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });
  connectLambda(event);

  try {
    const { email, code } = JSON.parse(event.body || '{}');
    if (!email || !code) return jsonResponse(400, { error: true, message: 'email and code required' });

    const auth = findAgent(email, code);
    if (!auth.configured) return jsonResponse(503, { error: true, message: 'Not configured' });
    if (!auth.agent) return jsonResponse(401, { error: true, message: 'Invalid credentials' });

    // Executive access only
    if (email.toLowerCase() !== 'management@mytravelroyalties.com') {
      return jsonResponse(403, { error: true, message: 'Executive access only' });
    }

    const agents = (loadAgents() || []).filter(a => a.role === 'agent' || a.role === 'lead');
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

    // Load all data
    const salesStore = getStore('sales');
    const leadsStore = getStore('leads');
    const chatStore = getStore('chat');

    const { blobs: salesBlobs } = await salesStore.list();
    const { blobs: leadsBlobs } = await leadsStore.list();
    const { blobs: chatBlobs } = await chatStore.list();

    // Aggregate agent metrics
    const agentMetrics = {};
    for (const agent of agents) {
      agentMetrics[agent.email.toLowerCase()] = {
        name: agent.name,
        email: agent.email,
        role: agent.role,
        dailyTarget: getDailyTarget(agent.email),
        monthlyTarget: getMonthlyTarget(agent.email),
        todaysSales: 0,
        todaysCallCount: 0,
        todaysARPC: 0,
        monthSales: 0,
        monthCallCount: 0,
        monthARPC: 0,
        dailyBreakdown: {}, // date -> { sales, calls }
      };
    }

    // Process sales
    for (const b of salesBlobs) {
      const sale = await salesStore.get(b.key, { type: 'json' });
      if (!sale) continue;
      const agentEmail = (sale.agentEmail || '').toLowerCase();
      if (!agentMetrics[agentEmail]) continue;

      const saleDate = sale.saleDate || sale.createdAt.slice(0, 10);
      const amount = sale.saleAmount || 0;

      agentMetrics[agentEmail].monthSales += amount;

      if (saleDate === today) {
        agentMetrics[agentEmail].todaysSales += amount;
      }

      // Daily breakdown
      if (!agentMetrics[agentEmail].dailyBreakdown[saleDate]) {
        agentMetrics[agentEmail].dailyBreakdown[saleDate] = { sales: 0, calls: 0 };
      }
      agentMetrics[agentEmail].dailyBreakdown[saleDate].sales += amount;
    }

    // Process leads
    for (const b of leadsBlobs) {
      const lead = await leadsStore.get(b.key, { type: 'json' });
      if (!lead) continue;
      const agentEmail = (lead.agentEmail || '').toLowerCase();
      if (!agentMetrics[agentEmail]) continue;

      const leadDate = lead.createdAt.slice(0, 10);
      agentMetrics[agentEmail].monthCallCount += 1;

      if (leadDate === today) {
        agentMetrics[agentEmail].todaysCallCount += 1;
      }

      if (!agentMetrics[agentEmail].dailyBreakdown[leadDate]) {
        agentMetrics[agentEmail].dailyBreakdown[leadDate] = { sales: 0, calls: 0 };
      }
      agentMetrics[agentEmail].dailyBreakdown[leadDate].calls += 1;
    }

    // Calculate ARPC
    for (const email in agentMetrics) {
      const m = agentMetrics[email];
      if (m.todaysCallCount > 0) {
        m.todaysARPC = m.todaysSales / m.todaysCallCount;
      }
      if (m.monthCallCount > 0) {
        m.monthARPC = m.monthSales / m.monthCallCount;
      }
    }

    // Collect all chat messages (hidden monitoring)
    const allChats = [];
    for (const b of chatBlobs) {
      const messages = await chatStore.get(b.key, { type: 'json' });
      if (messages && Array.isArray(messages)) {
        allChats.push({
          channel: b.key,
          messages: messages.slice(-20), // Last 20 messages per channel
        });
      }
    }

    return jsonResponse(200, {
      data: {
        today,
        agents: Object.values(agentMetrics).map(m => ({
          name: m.name,
          email: m.email,
          role: m.role,
          dailyTarget: Math.round(m.dailyTarget * 100) / 100,
          monthlyTarget: m.monthlyTarget,
          todaysSales: Math.round(m.todaysSales * 100) / 100,
          todaysCallCount: m.todaysCallCount,
          todaysARPC: Math.round(m.todaysARPC * 100) / 100,
          monthSales: Math.round(m.monthSales * 100) / 100,
          monthCallCount: m.monthCallCount,
          monthARPC: Math.round(m.monthARPC * 100) / 100,
          dailyBreakdown: m.dailyBreakdown,
        })),
        chats: allChats, // Hidden chat monitoring
      }
    });
  } catch (err) {
    return errorResponse(err);
  }
};
