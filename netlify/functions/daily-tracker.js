// POST /.netlify/functions/daily-tracker
// Body: { email, code }
// Returns daily performance data for the month (target vs actual for each day)
const { getStore, connectLambda } = require('@netlify/blobs');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');
const { findAgent } = require('./_agent-auth');

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
    if (auth.agent.role !== 'lead') return jsonResponse(403, { error: true, message: 'Leadership access only' });

    const salesStore = getStore('sales');
    const { blobs: salesBlobs } = await salesStore.list();

    // Get current month
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    // Initialize daily data
    const dailyData = [];
    for (let d = 1; d <= monthEnd.getDate(); d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const date = new Date(dateStr);
      const dayOfWeek = date.getDay();

      // Skip weekends (Saturday = 6, Sunday = 0)
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      dailyData.push({
        date: dateStr,
        day: d,
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        isWeekend,
        isToday: dateStr === new Date().toISOString().slice(0, 10),
        target: isWeekend ? 0 : Math.round(getDailyTarget(email) * 100) / 100,
        actual: 0,
      });
    }

    // Aggregate sales by date
    for (const b of salesBlobs) {
      const sale = await salesStore.get(b.key, { type: 'json' });
      if (!sale) continue;

      const saleDate = sale.saleDate || sale.createdAt.slice(0, 10);
      const dayData = dailyData.find(d => d.date === saleDate);
      if (dayData) {
        dayData.actual += sale.saleAmount || 0;
      }
    }

    // Calculate progress for each day
    for (const day of dailyData) {
      day.actual = Math.round(day.actual * 100) / 100;
      if (day.target > 0) {
        day.progress = Math.round((day.actual / day.target) * 1000) / 10;
      } else {
        day.progress = 0;
      }
    }

    // Calculate running totals
    let cumulativeTarget = 0, cumulativeActual = 0;
    for (const day of dailyData) {
      if (!day.isWeekend) {
        cumulativeTarget += day.target;
        cumulativeActual += day.actual;
      }
      day.cumulativeTarget = Math.round(cumulativeTarget * 100) / 100;
      day.cumulativeActual = Math.round(cumulativeActual * 100) / 100;
      day.cumulativeProgress = cumulativeTarget > 0 ? Math.round((cumulativeActual / cumulativeTarget) * 1000) / 10 : 0;
    }

    return jsonResponse(200, {
      data: {
        month: `${date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        days: dailyData,
      }
    });
  } catch (err) {
    return errorResponse(err);
  }
};
