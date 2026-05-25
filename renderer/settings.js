// DeepSeek Monitor — 设置窗口逻辑

const $ = (sel) => document.querySelector(sel);

const els = {
  apiKey: $('#apiKey'),
  btnVerify: $('#btnVerify'),
  apiKeyStatus: $('#apiKeyStatus'),
  refreshInterval: $('#refreshInterval'),
  panelResidence: $('#panelResidence'),
  btnImportCSV: $('#btnImportCSV'),
  importStatus: $('#importStatus'),
  autoImportFolder: $('#autoImportFolder'),
  btnBrowseFolder: $('#btnBrowseFolder'),
  autoExportEnabled: $('#autoExportEnabled'),
  autoExportInterval: $('#autoExportInterval'),
  btnOpenLogin: $('#btnOpenLogin'),
  exportStatus: $('#exportStatus'),
  btnClearCache: $('#btnClearCache'),
  cacheStatus: $('#cacheStatus'),
  themeSelect: $('#themeSelect'),
  chartType: $('#chartType'),
  chartMode: $('#chartMode'),
  apiFilter: $('#apiFilter'),
  opacitySlider: $('#opacitySlider'),
  opacityValue: $('#opacityValue'),
  btnClose: $('#btnClose')
};

async function init() {
  // 加载设置
  try {
    const settings = await window.deepseekAPI.getSettings();
    if (settings.apiKey) {
      els.apiKey.value = settings.apiKey;
    }
    els.refreshInterval.value = String(settings.refreshInterval || 60);
    els.panelResidence.value = String(settings.panelResidenceSeconds || 10);
    els.themeSelect.value = settings.theme || 'dark';
    document.body.setAttribute('data-theme', settings.theme || 'dark');
    els.chartType.value = settings.chartType || 'bar';
    els.chartMode.value = settings.chartMode || 'tokens';
    // 填充 API 筛选选项（含 Unknown）
    try {
      const apiNames = await window.deepseekAPI.getApiKeyNames();
      const cached = await window.deepseekAPI.getCachedDashboard();
      const records = cached?.usage?.data || [];
      const hasUnknown = records.some(r => !r.apiKeyName && (r.totalTokens > 0 || r.costInCents > 0));
      const allNames = [...(apiNames || [])];
      if (hasUnknown && !allNames.includes('Unknown')) allNames.push('Unknown');
      if (allNames.length) {
        const existing = new Set(Array.from(els.apiFilter.options).map(o => o.value));
        allNames.forEach(n => { if (!existing.has(n)) { const o = document.createElement('option'); o.value = n; o.textContent = n; els.apiFilter.appendChild(o); } });
      }
    } catch {}
    els.apiFilter.value = settings.apiFilter || '__all__';
    const opacity = settings.opacity != null ? settings.opacity : 0.92;
    els.opacitySlider.value = Math.round(opacity * 100);
    els.opacityValue.textContent = Math.round(opacity * 100) + '%';
    els.autoImportFolder.value = settings.autoImportFolder || '';
    els.autoExportEnabled.checked = settings.autoExportEnabled || false;
    els.autoExportInterval.value = String(settings.autoExportInterval || 300);
    updateExportStatus();
  } catch (err) {
    console.error('加载设置失败:', err);
  }

  // 验证并保存 API Key
  els.btnVerify.addEventListener('click', async () => {
    const key = els.apiKey.value.trim();
    if (!key) {
      showStatus(els.apiKeyStatus, '请输入 API Key', 'error');
      return;
    }

    els.btnVerify.disabled = true;
    els.btnVerify.textContent = '验证中...';

    try {
      // 保存 API Key
      await window.deepseekAPI.saveSettings({ apiKey: key });
      // 触发主面板刷新
      await window.deepseekAPI.refreshData();
      showStatus(els.apiKeyStatus, '✅ API Key 已保存并验证', 'success');
    } catch (err) {
      showStatus(els.apiKeyStatus, `❌ ${err.message}`, 'error');
    } finally {
      els.btnVerify.disabled = false;
      els.btnVerify.textContent = '验证并保存';
    }
  });

  // 刷新间隔变更
  els.refreshInterval.addEventListener('change', async () => {
    const val = parseInt(els.refreshInterval.value, 10);
    await window.deepseekAPI.saveSettings({ refreshInterval: val });
  });

  // 面板驻留时间变更
  els.panelResidence.addEventListener('change', async () => {
    const val = parseInt(els.panelResidence.value, 10);
    await window.deepseekAPI.saveSettings({ panelResidenceSeconds: val });
  });

  // 主题切换
  els.themeSelect.addEventListener('change', async () => {
    const theme = els.themeSelect.value;
    await window.deepseekAPI.saveSettings({ theme });
  });

  // 图表类型
  els.chartType.addEventListener('change', async () => {
    await window.deepseekAPI.saveSettings({ chartType: els.chartType.value });
  });

  // 图表数据模式
  els.chartMode.addEventListener('change', async () => {
    await window.deepseekAPI.saveSettings({ chartMode: els.chartMode.value });
  });

  // API 筛选
  els.apiFilter.addEventListener('change', async () => {
    await window.deepseekAPI.saveSettings({ apiFilter: els.apiFilter.value });
  });

  // 自动导出
  els.autoExportEnabled.addEventListener('change', async () => {
    await window.deepseekAPI.saveSettings({ autoExportEnabled: els.autoExportEnabled.checked });
    updateExportStatus();
  });
  els.autoExportInterval.addEventListener('change', async () => {
    await window.deepseekAPI.saveSettings({ autoExportInterval: parseInt(els.autoExportInterval.value) });
  });
  els.btnOpenLogin.addEventListener('click', () => {
    window.deepseekAPI.openLoginPage();
  });

  async function updateExportStatus() {
    try {
      const s = await window.deepseekAPI.getExportStatus();
      els.exportStatus.textContent = s.status + (s.lastFile ? ` (最近: ${s.lastFile})` : '');
    } catch { els.exportStatus.textContent = ''; }
  }

  // 透明度
  els.opacitySlider.addEventListener('input', () => {
    els.opacityValue.textContent = els.opacitySlider.value + '%';
  });
  els.opacitySlider.addEventListener('change', async () => {
    const opacity = parseInt(els.opacitySlider.value, 10) / 100;
    await window.deepseekAPI.saveSettings({ opacity });
    els.opacityValue.textContent = Math.round(opacity * 100) + '%';
  });

  // 自动导入目录
  els.autoImportFolder.addEventListener('change', async () => {
    await window.deepseekAPI.saveSettings({ autoImportFolder: els.autoImportFolder.value });
  });
  els.btnBrowseFolder.addEventListener('click', async () => {
    const folder = await window.deepseekAPI.browseFolder();
    if (folder) {
      els.autoImportFolder.value = folder;
      await window.deepseekAPI.saveSettings({ autoImportFolder: folder });
    }
  });

  // CSV 导入
  els.btnImportCSV.addEventListener('click', async () => {
    els.btnImportCSV.disabled = true;
    els.btnImportCSV.textContent = '导入中...';
    els.importStatus.classList.add('hidden');

    try {
      const result = await window.deepseekAPI.importCSV();
      if (!result) {
        // 用户取消
        els.btnImportCSV.disabled = false;
        els.btnImportCSV.textContent = '选择 CSV / ZIP 文件导入';
        return;
      }
      if (result.error) {
        showStatus(els.importStatus, `❌ ${result.error}`, 'error');
      } else {
        showStatus(els.importStatus, `✅ 成功导入 ${result.count} 条用量记录`, 'success');
        // 通知主面板刷新
        await window.deepseekAPI.refreshData();
      }
    } catch (err) {
      showStatus(els.importStatus, `❌ ${err.message}`, 'error');
    } finally {
      els.btnImportCSV.disabled = false;
      els.btnImportCSV.textContent = '选择 CSV / ZIP 文件导入';
    }
  });

  // 清除缓存
  els.btnClearCache.addEventListener('click', async () => {
    els.btnClearCache.disabled = true;
    try {
      await window.deepseekAPI.clearCache();
      showStatus(els.cacheStatus, '✅ 缓存已清除', 'success');
    } catch (err) {
      showStatus(els.cacheStatus, `❌ ${err.message}`, 'error');
    } finally {
      els.btnClearCache.disabled = false;
    }
  });

  // 关闭
  els.btnClose.addEventListener('click', () => {
    window.close();
  });
}

function showStatus(el, msg, type) {
  el.textContent = msg;
  el.className = `status-message ${type}`;
  el.classList.remove('hidden');
  // 3 秒后自动隐藏
  setTimeout(() => {
    el.classList.add('hidden');
  }, 3000);
}

init();
