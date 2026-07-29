// POST /.netlify/functions/submit-report
// Body: { agentEmail, agentCode, teamNotes, managementEmail }
// Team lead generates and submits a daily report with full metrics
const { getStore, connectLambda } = require('@netlify/blobs');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');
const { findAgent, loadAgents } = require('./_agent-auth');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = 'contact@mytravelroyalties.com';
const WORKING_DAYS_PER_MONTH = 22;

const QUOTAS = {
  'leo@mytravelroyalties.com': { monthlyTarget: 8000, minARPC: 100 },
  'ben@mytravelroyalties.com': { monthlyTarget: 8000, minARPC: 100 },
  'luke@mytravelroyalties.com': { monthlyTarget: 8000, minARPC: 100 },
  'shikhar@mytravelroyalties.com': { monthlyTarget: 10000, minARPC: 125 },
  'gaman@mytravelroyalties.com': { monthlyTarget: 10000, minARPC: 125 },
};

function getQuota(email) {
  return QUOTAS[email.toLowerCase()] || { monthlyTarget: 8000, minARPC: 100 };
}

function getDailyTarget(email) {
  const quota = getQuota(email);
  return quota.monthlyTarget / WORKING_DAYS_PER_MONTH;
}

function getTodayString() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

async function sendViaResend(to, subject, html) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to,
      subject,
      html,
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend error: ${response.status}`);
  }
  return await response.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });
  connectLambda(event);

  try {
    const { agentEmail, agentCode, teamNotes, managementEmail } = JSON.parse(event.body || '{}');
    if (!agentEmail || !agentCode) return jsonResponse(400, { error: true, message: 'agentEmail and agentCode required' });

    const auth = findAgent(agentEmail, agentCode);
    if (!auth.configured) return jsonResponse(503, { error: true, message: 'Not configured' });
    if (!auth.agent) return jsonResponse(401, { error: true, message: 'Invalid credentials' });
    if (auth.agent.role !== 'lead') return jsonResponse(403, { error: true, message: 'Only team leads can submit reports' });

    if (!RESEND_API_KEY) return jsonResponse(503, { error: true, message: 'Email service not configured' });
    if (!managementEmail) return jsonResponse(400, { error: true, message: 'managementEmail required' });

    const agents = (loadAgents() || []).filter(a => a.role === 'agent' || a.role === 'lead');
    const todayStr = getTodayString();

    // Gather metrics
    const salesStore = getStore('sales');
    const leadsStore = getStore('leads');
    const { blobs: salesBlobs } = await salesStore.list();
    const { blobs: leadsBlobs } = await leadsStore.list();

    const agentMetrics = {};
    for (const agent of agents) {
      agentMetrics[agent.email.toLowerCase()] = {
        name: agent.name,
        email: agent.email,
        dailyTarget: getDailyTarget(agent.email),
        todaysSales: 0,
        todaysCallCount: 0,
      };
    }

    for (const b of salesBlobs) {
      const sale = await salesStore.get(b.key, { type: 'json' });
      if (!sale) continue;
      const agentEmail = (sale.agentEmail || '').toLowerCase();
      const saleDate = sale.saleDate || sale.createdAt.slice(0, 10);
      if (saleDate === todayStr && agentMetrics[agentEmail]) {
        agentMetrics[agentEmail].todaysSales += sale.saleAmount || 0;
      }
    }

    for (const b of leadsBlobs) {
      const lead = await leadsStore.get(b.key, { type: 'json' });
      if (!lead) continue;
      const agentEmail = (lead.agentEmail || '').toLowerCase();
      const leadDate = lead.createdAt.slice(0, 10);
      if (leadDate === todayStr && agentMetrics[agentEmail]) {
        agentMetrics[agentEmail].todaysCallCount += 1;
      }
    }

    // Build report
    const reportId = `RPT-${Date.now()}`;
    const reportDate = new Date(todayStr);
    let teamSales = 0, teamCalls = 0, teamTarget = 0;
    for (const email in agentMetrics) {
      const m = agentMetrics[email];
      teamSales += m.todaysSales;
      teamCalls += m.todaysCallCount;
      teamTarget += m.dailyTarget;
    }

    const reportData = {
      id: reportId,
      createdAt: new Date().toISOString(),
      date: todayStr,
      teamLeadName: auth.agent.name,
      teamLeadEmail: auth.agent.email,
      teamNotes: teamNotes || '',
      summary: {
        teamSales: Math.round(teamSales * 100) / 100,
        teamTarget: Math.round(teamTarget * 100) / 100,
        teamProgress: teamTarget > 0 ? Math.round((teamSales / teamTarget) * 1000) / 10 : 0,
        teamCalls: teamCalls,
      },
      agents: Object.values(agentMetrics).map(m => ({
        name: m.name,
        email: m.email,
        dailyTarget: Math.round(m.dailyTarget * 100) / 100,
        sales: Math.round(m.todaysSales * 100) / 100,
        progress: m.dailyTarget > 0 ? Math.round((m.todaysSales / m.dailyTarget) * 1000) / 10 : 0,
        calls: m.todaysCallCount,
      })),
    };

    // Save to Blobs
    const reportsStore = getStore('reports');
    await reportsStore.setJSON(reportId, reportData);

    // Build email HTML
    const agentRowsHTML = reportData.agents.map(a => `
      <tr>
        <td style="padding:8px; border-bottom:1px solid #eee;">${a.name}</td>
        <td style="padding:8px; border-bottom:1px solid #eee; text-align:right;">$${Math.round(a.dailyTarget).toLocaleString()}</td>
        <td style="padding:8px; border-bottom:1px solid #eee; text-align:right;">$${a.sales.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
        <td style="padding:8px; border-bottom:1px solid #eee; text-align:right;">${a.progress.toFixed(0)}%</td>
        <td style="padding:8px; border-bottom:1px solid #eee; text-align:center;">${a.calls}</td>
      </tr>
    `).join('');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #2c2c2c; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #d4af37 0%, #1a1400 100%); color: #fff; padding: 20px; border-radius: 8px; text-align: center; }
    .header h1 { margin: 0; font-size: 20px; }
    .section { margin: 20px 0; padding: 16px; background: #f9f7f4; border-radius: 8px; }
    .section h2 { margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #1a1400; }
    .metric { display: flex; justify-content: space-between; padding: 6px 0; }
    .metric-label { color: #666; }
    .metric-value { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th { text-align: left; padding: 8px; background: #eee; font-size: 12px; font-weight: 600; border-bottom: 2px solid #d4af37; }
    .notes { background: #fff; border: 1px solid #d4af37; padding: 12px; border-radius: 6px; margin: 16px 0; font-size: 13px; line-height: 1.6; }
    .footer { text-align: center; color: #999; font-size: 11px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Daily Team Report</h1>
      <p style="margin: 8px 0 0 0; opacity: 0.9;">${reportDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    </div>

    <div class="section">
      <h2>Team Summary</h2>
      <div class="metric">
        <span class="metric-label">Revenue</span>
        <span class="metric-value">$${reportData.summary.teamSales.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Daily Target</span>
        <span class="metric-value">$${Math.round(reportData.summary.teamTarget).toLocaleString()}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Progress</span>
        <span class="metric-value" style="color: ${reportData.summary.teamProgress >= 100 ? '#22c55e' : reportData.summary.teamProgress >= 70 ? '#1a1400' : '#ef4444'};">${reportData.summary.teamProgress.toFixed(1)}%</span>
      </div>
      <div class="metric">
        <span class="metric-label">Calls Logged</span>
        <span class="metric-value">${reportData.summary.teamCalls}</span>
      </div>
    </div>

    <div class="section">
      <h2>Agent Performance</h2>
      <table>
        <thead><tr>
          <th>Agent</th>
          <th style="text-align: right;">Target</th>
          <th style="text-align: right;">Sales</th>
          <th style="text-align: right;">Progress</th>
          <th style="text-align: center;">Calls</th>
        </tr></thead>
        <tbody>
          ${agentRowsHTML}
        </tbody>
      </table>
    </div>

    ${reportData.teamNotes ? `
    <div class="notes">
      <strong>Team Lead Notes:</strong><br>
      ${reportData.teamNotes.replace(/\n/g, '<br>')}
    </div>
    ` : ''}

    <div class="footer">
      <p>Report ID: ${reportId}</p>
      <p>Submitted by: ${reportData.teamLeadName}</p>
      <p>© 2026 My Travel Royalties</p>
    </div>
  </div>
</body>
</html>
    `;

    // Send email
    await sendViaResend(managementEmail, `Daily Team Report – ${reportDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, html);

    return jsonResponse(200, {
      data: {
        success: true,
        reportId,
        sentTo: managementEmail,
        summary: reportData.summary,
      }
    });
  } catch (err) {
    return errorResponse(err);
  }
};
