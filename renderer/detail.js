// DeepSeek Monitor — 模型详情窗口

const $ = (sel) => document.querySelector(sel);
const charts = {};

const params = new URLSearchParams(window.location.search);
const currentModel = params.get('model') || 'flash';

const modelMeta = currentModel === 'pro'
  ? { name: 'V4 Pro', color: '#8B5CF6' }
  : { name: 'V4 Flash', color: '#3B82F6' };

function isModel(name) {
  const n = (name || '').toLowerCase();
  if (currentModel === 'pro') return n.includes('reasoner') || n.includes('pro') || n.includes('v4-pro');
  return n.includes('chat') || n.includes('flash') || n.includes('v4-flash');
}

async function init() {
  try {
    const s = await window.deepseekAPI.getSettings();
    document.body.setAttribute('data-theme', s.theme || 'dark');
  } catch {}
  $('#detailModelName').textContent = modelMeta.name + ' 详情';

  document.addEventListener('mouseenter', () => window.deepseekAPI.onDetailMouseEnter());
  document.addEventListener('mouseleave', () => window.deepseekAPI.onDetailMouseLeave());

  const cached = await window.deepseekAPI.getCachedDashboard();
  if (cached?.usage?.data) renderAll(cached.usage);

  window.deepseekAPI.onDataResult((d) => { if (d?.usage?.data) renderAll(d.usage); });
  window.deepseekAPI.onDataImported((d) => { if (d?.usage?.data) renderAll(d.usage); });
}

function renderAll(usage) {
  if (!usage?.data) return;
  const records = usage.data.filter(r => isModel(r.modelName));
  renderStats(records);
  renderTokenChart(records);
  renderCostChart(records);
  renderRequestChart(records);
  renderCacheChart(records);
}

// ── 统计数字 ──────────────────────────────────────────────
function renderStats(records) {
  const tokens = records.reduce((s, r) => s + r.totalTokens, 0);
  const cents = records.reduce((s, r) => s + r.costInCents, 0);
  const hit = records.reduce((s, r) => s + r.inputCacheHitTokens, 0);
  const miss = records.reduce((s, r) => s + r.inputCacheMissTokens, 0);
  const reqs = records.reduce((s, r) => s + r.requestCount, 0);
  const totalInput = hit + miss;
  const rate = totalInput > 0 ? ((hit / totalInput) * 100).toFixed(1) : '0';

  const hasT = tokens > 0;
  $('.stat-item:nth-child(1) .stat-label').textContent = hasT ? '总 Token' : '总消费';
  $('.stat-item:nth-child(3) .stat-label').textContent = hasT ? '缓存命中率' : '日均消费';
  $('.stat-item:nth-child(4) .stat-label').textContent = hasT ? '请求次数' : '最新日期';

  if (hasT) {
    $('#statTotalTokens').textContent = fmtNum(tokens);
    $('#statTotalCost').textContent = fmtCost(cents);
    $('#statPromptTokens').textContent = rate + '%';
    $('#statCompletionTokens').textContent = fmtNum(reqs);
    $('#statCacheInfo').textContent = `命中 ${fmtNum(hit)} / 未命中 ${fmtNum(miss)}`;
    $('#statRequestCount').textContent = '';
  } else {
    const days = records.length;
    $('#statTotalTokens').textContent = fmtCost(cents);
    $('#statTotalCost').textContent = '共 ' + days + ' 天';
    $('#statPromptTokens').textContent = days > 0 ? fmtCost(cents / days) : '¥0.00';
    $('#statCompletionTokens').textContent = records.length > 0 ? records[records.length-1].date : '-';
    $('#statCacheInfo').textContent = '';
    $('#statRequestCount').textContent = '';
  }
}

// ── 每日 Token ────────────────────────────────────────────
function renderTokenChart(records) {
  const { labels, hitVals, missVals, outVals } = aggregate7Days(records);
  const hasT = hitVals.reduce((s,v)=>s+v,0) + missVals.reduce((s,v)=>s+v,0) + outVals.reduce((s,v)=>s+v,0) > 0;
  const ds = hasT ? [
    { label: '缓存命中', data: hitVals, backgroundColor: '#34D39999', stack: 'stack' },
    { label: '缓存未命中', data: missVals, backgroundColor: '#F8717199', stack: 'stack' },
    { label: '输出 Token', data: outVals, backgroundColor: modelMeta.color + '99', stack: 'stack' }
  ] : [{ label: 'Token', data: labels.map(()=>0), backgroundColor: '#ccc' }];
  makeChart('chartTokens', 'bar', labels, ds, true, v => fmtNum(v));
}

// ── 每日费用 ──────────────────────────────────────────────
function renderCostChart(records) {
  const { labels, costVals } = aggregate7Days(records);
  const ds = [{ label: '费用', data: costVals, backgroundColor: modelMeta.color + 'CC', borderRadius: 4 }];
  makeChart('chartCost', 'bar', labels, ds, false, v => '¥'+v.toFixed(2));
}

// ── 每日请求 ──────────────────────────────────────────────
function renderRequestChart(records) {
  const { labels, reqVals } = aggregate7Days(records);
  const ds = [{ label: '请求', data: reqVals, backgroundColor: '#F59E0BCC', borderRadius: 4 }];
  makeChart('chartRequests', 'bar', labels, ds, false, v => fmtNum(v));
}

// ── 每日缓存命中率 ────────────────────────────────────────
function renderCacheChart(records) {
  const today = new Date();
  const labels = [], rates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const dr = records.filter(r => r.date === key);
    const hit = dr.reduce((s,r) => s + r.inputCacheHitTokens, 0);
    const miss = dr.reduce((s,r) => s + r.inputCacheMissTokens, 0);
    labels.push(`${d.getMonth()+1}/${d.getDate()}`);
    rates.push(hit + miss > 0 ? parseFloat(((hit/(hit+miss))*100).toFixed(1)) : 0);
  }
  const ds = [{ label: '命中率 %', data: rates, borderColor: '#34D399', backgroundColor: '#34D39920', tension: 0.3, fill: true, pointRadius: 3, borderWidth: 2 }];
  makeChart('chartCache', 'line', labels, ds, false, v => v+'%');
}

// ── 聚合 7 天数据 ─────────────────────────────────────────
function aggregate7Days(records) {
  const today = new Date();
  const labels = [], hitVals = [], missVals = [], outVals = [], costVals = [], reqVals = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const dr = records.filter(r => r.date === key);
    labels.push(`${d.getMonth()+1}/${d.getDate()}`);
    hitVals.push(dr.reduce((s,r) => s + r.inputCacheHitTokens, 0));
    missVals.push(dr.reduce((s,r) => s + r.inputCacheMissTokens, 0));
    outVals.push(dr.reduce((s,r) => s + r.completionTokens, 0));
    costVals.push(dr.reduce((s,r) => s + r.costInCents, 0) / 100);
    reqVals.push(dr.reduce((s,r) => s + r.requestCount, 0));
  }
  return { labels, hitVals, missVals, outVals, costVals, reqVals };
}

// ── 创建图表 ──────────────────────────────────────────────
function makeChart(id, type, labels, datasets, stacked, yFmt) {
  const ctx = $('#' + id);
  if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type, data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: datasets.length > 1, position: 'bottom', labels: { color: '#94A3B8', font: { size: 9 }, boxWidth: 8, padding: 6 } },
        tooltip: { backgroundColor: 'rgba(30,32,38,0.95)', callbacks: { label: (c) => `${c.dataset.label}: ${yFmt(c.raw)}` } }
      },
      scales: {
        x: { stacked, grid: { display: false }, ticks: { color: '#64748B', font: { size: 9 } } },
        y: { stacked, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748B', font: { size: 9 }, callback: yFmt, maxTicksLimit: 3 }, beginAtZero: true }
      }
    }
  });
}

// ── 工具 ──────────────────────────────────────────────────
function fmtNum(n) { if (!n) return '0'; if (n>=1e6) return (n/1e6).toFixed(1)+'M'; if (n>=1e3) return (n/1e3).toFixed(1)+'K'; return n.toLocaleString(); }
function fmtCost(c) { return '¥' + ((c||0)/100).toFixed(2); }
function closeDetail() { window.deepseekAPI.closeDetail(currentModel); }

init();
