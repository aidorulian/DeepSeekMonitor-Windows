// DeepSeek Monitor — 主面板渲染进程逻辑

const $ = (sel) => document.querySelector(sel);

const els = {
  emptyState: $('#emptyState'), dashboard: $('#dashboard'),
  errorBanner: $('#errorBanner'), warningBanner: $('#warningBanner'),
  balanceStatus: $('#balanceStatus'), balanceAmount: $('#balanceAmount'),
  dayCost: $('#dayCost'), monthCost: $('#monthCost'),
  flashTokens: $('#flashTokens'), flashCost: $('#flashCost'),
  proTokens: $('#proTokens'), proCost: $('#proCost'),
  lastUpdated: $('#lastUpdated'), refreshIcon: $('#refreshIcon'),
  refreshSpinner: $('#refreshSpinner'), btnRefresh: $('#btnRefresh'),
  btnPin: $('#btnPin'), pinIcon: $('#pinIcon'),
  apiFilterBar: $('#apiFilterBar'), apiFilterSelect: $('#apiFilterSelect')
};

let chart = null, currentData = null, isPinned = false;
let chartType = 'bar', chartMode = 'tokens';
let currentApiFilter = '__all__', allRecords = [], allApiNames = [];

// ── 初始化 ────────────────────────────────────────────────
async function init() {
  document.addEventListener('mouseenter', () => window.deepseekAPI.onPanelMouseEnter());
  document.addEventListener('mouseleave', () => window.deepseekAPI.onPanelMouseLeave());

  window.deepseekAPI.onDataResult(d => { try { handleDataResult(d); } catch(e) { console.error(e); } });
  window.deepseekAPI.onDataLoading(l => setLoading(l));
  window.deepseekAPI.onDataImported(d => { try { handleImportedData(d); } catch(e) { console.error(e); } });
  window.deepseekAPI.onPinnedState(p => updatePinState(p));
  window.deepseekAPI.onSettingsChanged(d => { try { applySettingsChange(d); } catch(e) { console.error(e); } });

  try {
    const s = await window.deepseekAPI.getSettings();
    applyTheme(s.theme || 'dark');
    chartType = s.chartType || 'bar';
    chartMode = s.chartMode || 'tokens';
    currentApiFilter = s.apiFilter || '__all__';
    isPinned = await window.deepseekAPI.getPinned();
    updatePinState(isPinned);

    const apiNames = await window.deepseekAPI.getApiKeyNames();
    populateApiFilter(apiNames);

    showDashboard();
    const cached = await window.deepseekAPI.getCachedDashboard();
    if (cached) {
      currentData = cached;
      allRecords = Array.isArray(cached.usage?.data) ? cached.usage.data : [];
      renderAll(cached);
    }
    refresh();
  } catch (e) { console.error('Init error:', e); showEmptyState(); }
}

// ── 显示切换 ──────────────────────────────────────────────
function showEmptyState() { els.emptyState.classList.remove('hidden'); els.dashboard.classList.add('hidden'); }
function showDashboard() { els.emptyState.classList.add('hidden'); els.dashboard.classList.remove('hidden'); }

// ── 加载状态 ──────────────────────────────────────────────
function setLoading(l) {
  if (l) { els.refreshIcon.classList.add('hidden'); els.refreshSpinner.classList.remove('hidden'); }
  else { els.refreshIcon.classList.remove('hidden'); els.refreshSpinner.classList.add('hidden'); }
}

// ── 数据刷新 ──────────────────────────────────────────────
async function refresh() { await window.deepseekAPI.refreshData(); }

function handleDataResult(data) {
  if (!data) return;
  if (data.error && !data.balance) { showError(data.error); return; }
  hideError();
  if (data.balanceError) showWarning(data.balanceError);
  else if (data.balance) { hideWarning(); currentData = data; renderBalance(data.balance); }
  if (data.usageError) showWarning(data.usageError);
  else if (data.usage && data.usage.data) { currentData = { ...currentData, usage: data.usage }; allRecords = data.usage.data; renderFiltered(); }
}

function handleImportedData(data) {
  if (!data?.usage?.data) return;
  showDashboard(); hideError(); hideWarning();
  allRecords = data.usage.data;
  currentData = { ...currentData, usage: data.usage };
  if (data.apiKeyNames?.length) populateApiFilter(data.apiKeyNames);
  renderFiltered();
  updateLastUpdated();
  showWarning(`已导入 ${data.count || 0} 条用量记录`);
}

// ── 渲染 ──────────────────────────────────────────────────
function renderBalance(b) {
  if (!b?.balanceInfos?.length) return;
  const info = b.balanceInfos[0];
  els.balanceAmount.textContent = fmtBal(info.totalBalance || 0);
  els.balanceStatus.textContent = b.isAvailable ? '可用' : '不可用';
  els.balanceStatus.className = b.isAvailable ? 'badge badge-green' : 'badge badge-red';
}

function renderUsage(records) {
  const fr = records.filter(r => isFlash(r.modelName));
  const pr = records.filter(r => isPro(r.modelName));
  const ft = fr.reduce((s,r) => s + r.totalTokens, 0);
  const fc = fr.reduce((s,r) => s + r.costInCents, 0);
  const pt = pr.reduce((s,r) => s + r.totalTokens, 0);
  const pc = pr.reduce((s,r) => s + r.costInCents, 0);

  if (ft > 0 || pt > 0) {
    els.flashTokens.textContent = fmtNum(ft) + ' Token';
    els.proTokens.textContent = fmtNum(pt) + ' Token';
  } else {
    els.flashTokens.textContent = fc > 0 ? '消费 ¥' + (fc/100).toFixed(2) : '无数据';
    els.proTokens.textContent = pc > 0 ? '消费 ¥' + (pc/100).toFixed(2) : '无数据';
  }
  els.flashCost.textContent = fmtCost(fc);
  els.proCost.textContent = fmtCost(pc);
}

function renderCosts(records) {
  const now = new Date();
  const ts = now.toISOString().split('T')[0], ms = ts.slice(0,7);
  let dc = 0, mc = 0;
  for (const r of records) { if (r.date === ts) dc += r.costInCents; if (r.date.startsWith(ms)) mc += r.costInCents; }
  els.dayCost.textContent = fmtCost(dc);
  els.monthCost.textContent = fmtCost(mc);
}

function renderAll(cached) {
  if (!cached) return;
  showDashboard();
  if (cached.balance) renderBalance(cached.balance);
  if (cached.usage?.data) { allRecords = cached.usage.data; renderFiltered(); }
}

// ── 统一图表渲染（单数据集 / 多 API 数据集同一套 UI）───
function renderChart(records) {
  if (!records?.length) return;
  const apiSplit = currentApiFilter === '__split__';
  const apis = apiSplit ? [...new Set(records.map(r => r.apiKeyName || 'Unknown'))].sort() : [];
  const isMulti = apiSplit && apis.length > 1;

  const today = new Date();
  const labels = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); labels.push(`${d.getMonth()+1}/${d.getDate()}`); }

  const colors = ['#4D6BFE', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#EC4899'];
  const isCost = chartMode === 'cost';
  const isBar = chartType === 'bar';
  const isLine = chartType === 'line';

  let datasets;
  if (!isMulti) {
    const vals = [];
    const byDate = {};
    for (const r of records) { const v = isCost ? r.costInCents : r.totalTokens; byDate[r.date] = (byDate[r.date] || 0) + v; }
    for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); vals.push(byDate[d.toISOString().split('T')[0]] || 0); }
    datasets = [{
      data: vals,
      backgroundColor: isBar ? (ctx => { const c=ctx.chart; const ca=c.chartArea; if(!ca)return'rgba(77,107,254,0.5)'; const g=c.ctx.createLinearGradient(0,ca.top,0,ca.bottom); g.addColorStop(0,'rgba(77,107,254,0.7)'); g.addColorStop(1,'rgba(77,107,254,0.1)'); return g; }) : 'rgba(77,107,254,0.6)',
      borderColor: isLine ? '#4D6BFE' : undefined,
      borderWidth: isLine ? 2 : 0,
      borderRadius: isBar ? 6 : 0, borderSkipped: false, maxBarThickness: 28,
      tension: 0.3, pointRadius: isLine ? 3 : 0, pointBackgroundColor: '#4D6BFE', fill: isLine
    }];
  } else {
    datasets = apis.map((api, idx) => {
      const vals = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const dr = records.filter(r => r.date === d.toISOString().split('T')[0] && (r.apiKeyName || 'Unknown') === api);
        vals.push(dr.reduce((s,r) => s + (isCost ? r.costInCents : r.totalTokens), 0));
      }
      return {
        label: api, data: vals,
        backgroundColor: colors[idx % colors.length] + (isBar ? 'CC' : '20'),
        borderColor: colors[idx % colors.length],
        ...(isBar ? { borderRadius: 4, borderSkipped: false, maxBarThickness: 20 }
                : { tension: 0.3, pointRadius: 3, fill: false, borderWidth: 2 })
      };
    });
  }

  // 统一绘制
  if (chart) { chart.destroy(); chart = null; }
  const ctx = $('#usageChart'); if (!ctx) return;
  chart = new Chart(ctx, {
    type: chartType, data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: isMulti, position: 'bottom', labels: { color: '#94A3B8', font: { size: 10 }, boxWidth: 10, padding: 8 } },
        tooltip: {
          backgroundColor: 'rgba(30,32,38,0.95)', titleColor: '#94A3B8', bodyColor: '#F1F5F9',
          borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, cornerRadius: 8, padding: 10,
          callbacks: { label: c => `${isMulti?c.dataset.label+': ':''}${isCost?'¥'+(c.raw/100).toFixed(2):fmtNum(c.raw)+' Token'}` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748B', font: { size: 10 }, maxRotation: 0 }, border: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
          ticks: { color: '#64748B', font: { size: 10 }, callback: v => isCost?'¥'+(v/100).toFixed(0):fmtNum(v), maxTicksLimit: 4 },
          border: { display: false }, beginAtZero: true }
      }
    }
  });
}

// ── 筛选 + 重渲染 ─────────────────────────────────────────
function renderFiltered() {
  const filtered = allRecords.filter(r => currentApiFilter === '__all__' || currentApiFilter === '__split__' ? true : (r.apiKeyName || 'Unknown') === currentApiFilter);
  if (!filtered.length && allRecords.length) {
    els.flashTokens.textContent = '无数据'; els.flashCost.textContent = '¥0.00';
    els.proTokens.textContent = '无数据'; els.proCost.textContent = '¥0.00';
    els.dayCost.textContent = '¥0.00'; els.monthCost.textContent = '¥0.00';
    return;
  }
  renderUsage(filtered);
  renderCosts(filtered);
  renderChart(filtered);
}

// ── API 筛选 ──────────────────────────────────────────────
function populateApiFilter(names) {
  allApiNames = names || [];
  // 检查是否有无 API 名的记录（已删除的 Key）
  const hasUnknown = allRecords.some(r => !r.apiKeyName && (r.totalTokens > 0 || r.costInCents > 0));
  const sel = els.apiFilterSelect;
  let html = '<option value="__all__">全部 API</option>';
  const allNames = [...(names || [])];
  if (hasUnknown && !allNames.includes('Unknown')) allNames.push('Unknown');
  if (allNames.length) {
    html += '<option value="__split__">分API展示</option>';
    allNames.forEach(n => { html += `<option value="${n}">${n}</option>`; });
    els.apiFilterBar.classList.remove('hidden');
  } else { els.apiFilterBar.classList.add('hidden'); }
  sel.innerHTML = html;
  sel.value = currentApiFilter;
  sel.onchange = () => { currentApiFilter = sel.value; renderFiltered(); };
}

// ── 设置变更即时生效 ──────────────────────────────────────
function applySettingsChange(data) {
  if (data.theme) applyTheme(data.theme);
  if (data.chartType) chartType = data.chartType;
  if (data.chartMode) chartMode = data.chartMode;
  if (data.apiFilter !== undefined) { currentApiFilter = data.apiFilter; els.apiFilterSelect.value = currentApiFilter; }
  if (data.chartType || data.chartMode || data.apiFilter !== undefined) renderFiltered();
}

// ── 主题 / 固定 ───────────────────────────────────────────
function applyTheme(t) { document.body.setAttribute('data-theme', t); }
function togglePin() { window.deepseekAPI.togglePin(); }
function updatePinState(p) { isPinned = p; els.btnPin.classList.toggle('pinned', p); if (p) els.pinIcon.setAttribute('fill','#4D6BFE'); else els.pinIcon.removeAttribute('fill'); }

// ── 错误 / 状态 ───────────────────────────────────────────
function showError(m) { els.errorBanner.textContent = m; els.errorBanner.classList.remove('hidden'); }
function hideError() { els.errorBanner.classList.add('hidden'); }
function showWarning(m) { els.warningBanner.textContent = m; els.warningBanner.classList.remove('hidden'); }
function hideWarning() { els.warningBanner.classList.add('hidden'); }
function updateLastUpdated() { els.lastUpdated.textContent = '上次刷新: ' + new Date().toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', second:'2-digit' }); }

// ── 窗口操作 ──────────────────────────────────────────────
function openSettings() { window.deepseekAPI.openSettings(); }
function closePanel() { window.deepseekAPI.closePanel(); }
function openDetail(model) { window.deepseekAPI.openDetail(model); }

// ── 工具 ──────────────────────────────────────────────────
function isFlash(n) { const s=(n||'').toLowerCase(); return s.includes('chat')||s.includes('flash')||s.includes('v4-flash'); }
function isPro(n) { const s=(n||'').toLowerCase(); return s.includes('reasoner')||s.includes('pro')||s.includes('v4-pro'); }
function fmtNum(n) { if(!n||isNaN(n))return'0'; if(n>=1e6)return(n/1e6).toFixed(1)+'M'; if(n>=1e3)return(n/1e3).toFixed(1)+'K'; return n.toLocaleString(); }
function fmtCost(c) { return '¥'+((c||0)/100).toFixed(2); }
function fmtBal(y) { return '¥'+(y||0).toFixed(2); }

init();
