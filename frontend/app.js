/* ── Dashboard App ───────────────────────────────────────────────────────── */
'use strict';

const API = '/api/dashboard';
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 min

let chartMonthly = null;
let chartConversion = null;
let chartRotation = null;

// ── Utilities ─────────────────────────────────────────────────────────────
const fmt = (n, style = 'currency', decimals = 0) =>
  new Intl.NumberFormat('es-MX', {
    style, currency: 'MXN', minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    notation: Math.abs(n) >= 1e6 ? 'compact' : 'standard',
  }).format(n);

const fmtFull = n =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);

const el = id => document.getElementById(id);

function showLoading(show) {
  el('loading-overlay').classList.toggle('hidden', !show);
}

function showError(msg) {
  const b = el('error-banner');
  if (msg) { b.textContent = msg; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
}

// ── Clock ─────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  el('clock').textContent = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  el('today-date').textContent = now.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
setInterval(updateClock, 1000);
updateClock();

// ── Render KPIs ───────────────────────────────────────────────────────────
function renderKPIs(data) {
  const kpis = data.kpis || {};
  const combined = kpis.combined || {};
  const sf = kpis.sancorfashion || {};
  const bk = kpis.bekura || {};

  el('kpi-sales').textContent    = fmt(combined.total_sales || 0);
  el('kpi-period').textContent   = combined.period || '';
  el('kpi-sf-sales').textContent = `SF ${fmt(sf.sales || 0)}`;
  el('kpi-bk-sales').textContent = `BK ${fmt(bk.sales || 0)}`;

  el('kpi-orders').textContent      = (combined.total_orders || 0).toLocaleString('es-MX');
  el('kpi-orders-sub').textContent  = 'Órdenes pagadas';
  el('kpi-sf-orders').textContent   = `SF ${sf.orders || 0}`;
  el('kpi-bk-orders').textContent   = `BK ${bk.orders || 0}`;

  el('kpi-ticket').textContent    = fmt(combined.avg_ticket || 0);
  el('kpi-sf-ticket').textContent = `SF ${fmt(sf.avg_ticket || 0)}`;
  el('kpi-bk-ticket').textContent = `BK ${fmt(bk.avg_ticket || 0)}`;

  // Goal
  const goal = data.goal || {};
  el('goal-month-label').textContent = goal.month || 'Abril 2026';
  el('goal-current').textContent     = fmt(goal.current || 0);
  el('goal-target').textContent      = fmt(goal.amount || 14000000);
  el('goal-remaining').textContent   = fmt(goal.remaining || goal.amount || 14000000);
  el('needed-per-day').textContent   = fmtFull(goal.needed_per_day || 466667);

  const pct = Math.min(100, goal.percentage || 0);
  el('goal-bar').style.width = pct + '%';
  el('goal-pct').textContent = pct.toFixed(1) + '%';
}

// ── Monthly Trend Chart ───────────────────────────────────────────────────
function renderMonthlyChart(trend) {
  const labels = trend.map(t => t.month);
  const sfData = trend.map(t => t.sancorfashion || 0);
  const bkData = trend.map(t => t.bekura || 0);

  const ctx = el('chart-monthly').getContext('2d');
  if (chartMonthly) chartMonthly.destroy();

  chartMonthly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'SANCORFASHION',
          data: sfData,
          backgroundColor: 'rgba(129,140,248,.8)',
          borderColor: '#818cf8',
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: 'BEKURA',
          data: bkData,
          backgroundColor: 'rgba(52,211,153,.7)',
          borderColor: '#34d399',
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmtFull(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: {
          stacked: false,
          ticks: { color: '#64748b', font: { size: 11 } },
          grid: { color: 'rgba(255,255,255,.04)' },
        },
        y: {
          ticks: {
            color: '#64748b', font: { size: 11 },
            callback: v => fmt(v),
          },
          grid: { color: 'rgba(255,255,255,.06)' },
        },
      },
    },
  });
}

// ── Conversion Rate Chart ─────────────────────────────────────────────────
function renderConversionChart(convList) {
  // Show last 30 days
  const labels  = convList.map(d => d.date.slice(5)); // MM-DD
  const sfRates = convList.map(d => d.sf_rate || 0);
  const bkRates = convList.map(d => d.bk_rate || 0);
  const totalRates = convList.map(d => d.total_rate || 0);

  const ctx = el('chart-conversion').getContext('2d');
  if (chartConversion) chartConversion.destroy();

  chartConversion = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'SANCORFASHION',
          data: sfRates,
          borderColor: '#818cf8',
          backgroundColor: 'rgba(129,140,248,.1)',
          pointRadius: 2,
          tension: 0.3,
          fill: false,
        },
        {
          label: 'BEKURA',
          data: bkRates,
          borderColor: '#34d399',
          backgroundColor: 'rgba(52,211,153,.1)',
          pointRadius: 2,
          tension: 0.3,
          fill: false,
        },
        {
          label: 'Total',
          data: totalRates,
          borderColor: '#fbbf24',
          backgroundColor: 'rgba(251,191,36,.08)',
          pointRadius: 3,
          tension: 0.3,
          borderWidth: 2,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(2)}%`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 10 },
          grid: { color: 'rgba(255,255,255,.04)' },
        },
        y: {
          ticks: { color: '#64748b', font: { size: 11 }, callback: v => v + '%' },
          grid: { color: 'rgba(255,255,255,.06)' },
        },
      },
    },
  });

  // Today conversion stats
  const today = new Date().toISOString().slice(0, 10);
  const todayEntry = convList.find(d => d.date === today) || convList[convList.length - 1] || {};
  el('conv-today-sf').textContent = (todayEntry.sf_rate || 0).toFixed(2) + '%';
  el('conv-today-bk').textContent = (todayEntry.bk_rate || 0).toFixed(2) + '%';

  const avgRate = convList.reduce((s, d) => s + (d.total_rate || 0), 0) / (convList.length || 1);
  el('conv-avg').textContent = avgRate.toFixed(2) + '%';
  el('visits-today').textContent = (todayEntry.total_visits || 0).toLocaleString('es-MX');
}

// ── Top Products Table ────────────────────────────────────────────────────
function renderTopProducts(products) {
  const tbody = el('tbody-top');
  if (!products || products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Sin datos de ventas este mes</td></tr>';
    return;
  }
  tbody.innerHTML = products.map(p => {
    const rankClass = p.rank === 1 ? 'rank-1' : p.rank === 2 ? 'rank-2' : p.rank === 3 ? 'rank-3' : 'rank-other';
    const acct = (p.account || '').toUpperCase();
    const pillClass = acct.includes('SAN') ? 'pill-sf' : 'pill-bk';
    const acctLabel = acct.includes('SAN') ? 'SF' : 'BK';
    return `<tr>
      <td><span class="rank-badge ${rankClass}">${p.rank}</span></td>
      <td title="${escHtml(p.title || p.id)}">${escHtml(truncate(p.title || p.id, 42))}</td>
      <td><span class="account-pill ${pillClass}">${acctLabel}</span></td>
      <td>${(p.units_sold || 0).toLocaleString('es-MX')}</td>
      <td>${fmtFull(p.revenue || 0)}</td>
    </tr>`;
  }).join('');
}

// ── Slow Products Table ───────────────────────────────────────────────────
function renderSlowProducts(products) {
  const tbody = el('tbody-slow');
  if (!products || products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No se encontraron productos lentos</td></tr>';
    return;
  }
  tbody.innerHTML = products.slice(0, 25).map(p => {
    const acct = (p.account || '').toUpperCase();
    const pillClass = acct.includes('SAN') ? 'pill-sf' : 'pill-bk';
    const acctLabel = acct.includes('SAN') ? 'SF' : 'BK';
    const soldClass = (p.units_sold || 0) === 0 ? 'units-sold-0' : '';
    return `<tr>
      <td><a href="https://www.mercadolibre.com.mx/p/${p.id}" target="_blank" style="color:var(--sf);font-size:.72rem">${p.id}</a></td>
      <td title="${escHtml(p.title || p.id)}">${escHtml(truncate(p.title || p.id, 38))}</td>
      <td><span class="account-pill ${pillClass}">${acctLabel}</span></td>
      <td class="${soldClass}">${(p.units_sold || 0)} unid.</td>
    </tr>`;
  }).join('');
}

// ── Inventory Section ─────────────────────────────────────────────────────
function renderInventory(inv) {
  const badge = el('odoo-status-badge');
  if (!inv || inv.error) {
    badge.textContent = inv?.error ? 'Error' : 'Desconectado';
    badge.className = 'badge-status status-error';
    el('inv-value').textContent = '—';
    el('inv-rotation').textContent = '—';
    el('inv-sales').textContent = '—';
    el('inv-units').textContent = inv?.error || '';
    renderGauge(0);
    return;
  }

  badge.textContent = '● Conectado';
  badge.className = 'badge-status status-ok';

  el('inv-value').textContent   = fmt(inv.inventory_value || 0);
  el('inv-rotation').textContent = (inv.rotation_percentage || 0).toFixed(1) + '%';
  el('inv-sales').textContent   = fmt(inv.sales_revenue || 0);
  el('inv-units').textContent   = `${(inv.inventory_units || 0).toLocaleString('es-MX')} uds · ${inv.product_count || 0} SKUs`;

  renderGauge(inv.rotation_percentage || 0);
}

function renderGauge(pct) {
  const ctx = el('chart-rotation').getContext('2d');
  if (chartRotation) chartRotation.destroy();
  const clamped = Math.min(100, Math.max(0, pct));
  const remaining = 100 - clamped;
  const color = clamped >= 60 ? '#10b981' : clamped >= 30 ? '#f59e0b' : '#f87171';

  chartRotation = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [clamped, remaining],
        backgroundColor: [color, 'rgba(255,255,255,.06)'],
        borderWidth: 0,
      }],
    },
    options: {
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
    plugins: [{
      id: 'centerText',
      afterDraw(chart) {
        const { ctx: c, chartArea: { top, bottom, left, right } } = chart;
        c.save();
        c.font = 'bold 1.2rem Inter, sans-serif';
        c.fillStyle = '#fff';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(clamped.toFixed(1) + '%', (left + right) / 2, (top + bottom) / 2);
        c.restore();
      },
    }],
  });
}

// ── Main Render ───────────────────────────────────────────────────────────
function render(data) {
  renderKPIs(data);
  renderMonthlyChart(data.monthly_trend || []);
  renderConversionChart(data.daily_conversion || []);
  renderTopProducts(data.top_products || []);
  renderSlowProducts(data.slow_products || []);
  renderInventory(data.inventory || {});

  const meta = data.meta || {};
  el('last-updated').textContent = meta.updated_at
    ? new Date(meta.updated_at).toLocaleString('es-MX') + (meta.from_cache ? ' (caché)' : ' (fresco)')
    : '--';
}

// ── Fetch & Refresh ───────────────────────────────────────────────────────
async function fetchData(force = false) {
  showError(null);
  try {
    if (force) await fetch('/api/refresh');
    const res = await fetch(API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);
  } catch (err) {
    console.error('Dashboard fetch error:', err);
    showError(`Error al cargar datos: ${err.message}. Reintentando en 30 segundos…`);
  }
}

async function refreshData() {
  const btn = document.querySelector('.refresh-btn');
  btn.classList.add('spinning');
  showLoading(true);
  await fetchData(true);
  showLoading(false);
  btn.classList.remove('spinning');
}

// ── Helpers ───────────────────────────────────────────────────────────────
function truncate(str, max) { return str && str.length > max ? str.slice(0, max) + '…' : str; }
function escHtml(str) { return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Boot ──────────────────────────────────────────────────────────────────
(async () => {
  showLoading(true);
  await fetchData(false);
  showLoading(false);
  setInterval(() => fetchData(false), REFRESH_INTERVAL);
})();
