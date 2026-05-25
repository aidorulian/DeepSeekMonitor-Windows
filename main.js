const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchBalance, fetchRecentUsage } = require('./src/api');
const { UsageCSVImporter } = require('./src/csv-import');
const { UsageAutoImportService } = require('./src/auto-import');
const { UsageExportAutomation } = require('./src/auto-export');
const { getCacheStore } = require('./src/cache');

// ── 单实例锁 ──────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      showPanel();
    }
  }
});

// ── 全局状态 ──────────────────────────────────────────────
let tray = null;
let mainWindow = null;
let settingsWindow = null;
let autoCloseTimer = null;
let mouseOnPanel = false;
let mouseOnDetail = false;
let panelPinned = false;

const store = getCacheStore();
const autoImport = new UsageAutoImportService();
const autoExport = new UsageExportAutomation();

// ── 面板配置 ──────────────────────────────────────────────
const PANEL_WIDTH = 356;
const PANEL_HEIGHT = 540;
const PANEL_CORNER = 22;
const PANEL_TOP_GAP = 8;
const DETAIL_WIDTH = 420;

// ── 中文菜单栏 ──────────────────────────────────────────
function setupMenu() {
  const { Menu } = require('electron');
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => refreshData() },
        { label: '设置', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'reload' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App 启动 ──────────────────────────────────────────────
app.whenReady().then(async () => {
  setupMenu();
  createTray();
  scheduleAutoRefresh();
  await startupAutoImport();

  // 自动导出
  autoExport.enabled = store.get('autoExportEnabled', false);
  autoExport.intervalSec = store.get('autoExportInterval', 300);
  autoExport.importDir = store.get('autoImportFolder', '');
  autoExport.onDownloadReady = (filePath) => {
    importFileFromPath(filePath);
  };
  if (autoExport.enabled) autoExport.start();
  app.on('activate', () => {});
});

app.on('window-all-closed', (e) => {
  // 不退出，保持托盘运行
});

app.on('before-quit', () => {
  cleanup();
});

// ── 系统托盘 ──────────────────────────────────────────────
function createTray() {
  // 尝试多个图标路径
  const iconPaths = [
    path.join(__dirname, 'assets', 'deepseek-icon.png'),
    path.join(__dirname, 'tubiao.ico'),
    path.join(__dirname, 'assets', 'icon.png'),
  ];
  let icon = null;
  for (const p of iconPaths) {
    try {
      if (fs.existsSync(p)) {
        icon = nativeImage.createFromPath(p);
        if (!icon.isEmpty()) break;
      }
    } catch { /* try next */ }
  }
  if (!icon || icon.isEmpty()) {
    icon = createFallbackIcon();
  }
  const resized = icon.resize({ width: 16, height: 16 });

  tray = new Tray(resized);
  tray.setToolTip('DeepSeek Monitor');

  tray.on('click', (event, bounds) => {
    showPanel(bounds);
  });

  tray.on('right-click', () => {
    showContextMenu();
  });

  // 如果之前有缓存的 API Key，启动时静默刷新一次
  const apiKey = store.get('apiKey', '');
  if (apiKey) {
    refreshData();
  }

  // 启动自动导入监测
  autoImport.start();
}

function createFallbackIcon() {
  // 16x16 蓝色方块作为后备图标
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // 圆角方形：DeepSeek 蓝 #4D6BFE
      const cx = size / 2, cy = size / 2;
      const dx = Math.abs(x - cx + 0.5), dy = Math.abs(y - cy + 0.5);
      if (Math.sqrt(dx * dx + dy * dy) < size / 2 - 1) {
        buf[i] = 77;    // R
        buf[i + 1] = 107; // G
        buf[i + 2] = 254; // B
        buf[i + 3] = 255; // A
      } else {
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function showContextMenu() {
  const menu = Menu.buildFromTemplate([
    { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => refreshData() },
    { type: 'separator' },
    { label: '设置', click: () => openSettings() },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit(); } }
  ]);
  tray.popUpContextMenu(menu);
}

// ── 主面板窗口 ────────────────────────────────────────────
function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  mainWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    movable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 应用保存的透明度
  const savedOpacity = store.get('opacity', 0.92);
  mainWindow.setOpacity(savedOpacity);

  mainWindow.on('blur', () => {
    if (panelPinned) return;
    const anyDetailFocused = Object.values(detailWindows).some(w => w && !w.isDestroyed() && w.isFocused());
    if (!anyDetailFocused) {
      setTimeout(() => {
        const stillNoDetailFocused = !Object.values(detailWindows).some(w => w && !w.isDestroyed() && w.isFocused());
        if (mainWindow && !mainWindow.isDestroyed() &&
            !mouseOnPanel && !mouseOnDetail && !panelPinned &&
            (!settingsWindow || !settingsWindow.isFocused()) &&
            stillNoDetailFocused) {
          closePanel();
        }
      }, 200);
    }
  });

  // 监听鼠标进出
  mainWindow.on('show', () => {
    startAutoCloseTimer();
  });

  mainWindow.on('hide', () => {
    clearAutoCloseTimer();
  });

  return mainWindow;
}

function showPanel(trayBounds) {
  const win = createMainWindow();
  const bounds = trayBounds || tray.getBounds();

  // 计算面板位置：在托盘图标上方居中
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const workArea = display.workArea;

  let x = Math.round(bounds.x + bounds.width / 2 - PANEL_WIDTH / 2);
  let y = Math.round(bounds.y - PANEL_HEIGHT - PANEL_TOP_GAP);

  // 确保不超出屏幕左右
  if (x < workArea.x + 4) x = workArea.x + 4;
  if (x + PANEL_WIDTH > workArea.x + workArea.width - 4) {
    x = workArea.x + workArea.width - PANEL_WIDTH - 4;
  }
  // 如果上方空间不够，显示在下方
  if (y < workArea.y) {
    y = Math.round(bounds.y + bounds.height + PANEL_TOP_GAP);
  }
  // 确保不超出屏幕底部
  if (y + PANEL_HEIGHT > workArea.y + workArea.height - 4) {
    y = workArea.y + workArea.height - PANEL_HEIGHT - 4;
  }

  win.setPosition(x, y);
  win.show();
  win.focus();
}

function closePanel() {
  clearAutoCloseTimer();
  closeDetailWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function togglePanel() {
  if (mainWindow && mainWindow.isVisible()) {
    closePanel();
  } else {
    showPanel();
  }
}

// ── 自动关闭计时器 ────────────────────────────────────────
function startAutoCloseTimer() {
  clearAutoCloseTimer();
  if (panelPinned) return; // 固定模式不自动关闭
  const seconds = store.get('panelResidenceSeconds', 10);
  autoCloseTimer = setTimeout(() => {
    if (!mouseOnPanel && !mouseOnDetail && !panelPinned) {
      closePanel();
    }
  }, seconds * 1000);
}

function clearAutoCloseTimer() {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }
}

// ── 设置窗口 ──────────────────────────────────────────────
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 720,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ── 详情窗口（每模型最多一个）─────────────────────────────
const detailWindows = {}; // { 'flash': BrowserWindow, 'pro': BrowserWindow }

function openDetailWindow(model) {
  const modelKey = typeof model === 'string' ? model : (model.rawValue === 'deepseek-reasoner' ? 'pro' : 'flash');

  // 已有同模型窗口 → 聚焦
  if (detailWindows[modelKey] && !detailWindows[modelKey].isDestroyed()) {
    detailWindows[modelKey].focus();
    return;
  }

  const win = new BrowserWindow({
    width: DETAIL_WIDTH,
    height: 620,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'detail.html'), {
    query: { model: modelKey }
  });

  win.on('closed', () => {
    delete detailWindows[modelKey];
  });

  // 定位在面板右侧（偏移已有窗口）
  if (mainWindow && mainWindow.isVisible()) {
    const [mainX, mainY] = mainWindow.getPosition();
    const [mainW] = mainWindow.getSize();
    const offset = Object.keys(detailWindows).length * 30;
    win.setPosition(mainX + mainW + 8 + offset, mainY + offset);
  }

  detailWindows[modelKey] = win;
  win.show();
  win.focus();
}

function closeDetailWindow(modelKey) {
  if (modelKey && detailWindows[modelKey] && !detailWindows[modelKey].isDestroyed()) {
    detailWindows[modelKey].close();
    delete detailWindows[modelKey];
  } else if (!modelKey) {
    // 关闭所有
    Object.keys(detailWindows).forEach(k => {
      if (detailWindows[k] && !detailWindows[k].isDestroyed()) detailWindows[k].close();
    });
  }
}

// ── 数据刷新 ──────────────────────────────────────────────
let isRefreshing = false;

async function refreshData() {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    const apiKey = store.get('apiKey', '');
    if (!apiKey) {
      sendToRenderer('data:result', { error: '请先配置 API Key' });
      return;
    }

    sendToRenderer('data:loading', true);

    const [balance, usage] = await Promise.all([
      fetchBalance(apiKey).catch(e => ({ __error: e })),
      fetchRecentUsage(apiKey, 7).catch(e => ({ __error: e }))
    ]);

    const result = {};

    if (balance.__error) {
      result.balanceError = balance.__error.message || String(balance.__error);
    } else {
      result.balance = balance;
    }

    if (usage.__error) {
      result.usageError = usage.__error.message || String(usage.__error);
    } else {
      result.usage = usage;
    }

    // 缓存数据 — 保留已有的 CSV 用量数据不被 API 失败覆盖
    const prev = store.get('cachedDashboard', {});
    store.set('cachedDashboard', {
      balance: balance.__error ? (prev.balance || null) : balance,
      usage: usage.__error ? (prev.usage || null) : usage,
      timestamp: Date.now()
    });

    sendToRenderer('data:result', result);
  } catch (err) {
    sendToRenderer('data:result', { error: err.message });
  } finally {
    isRefreshing = false;
    sendToRenderer('data:loading', false);
  }
}

// ── IPC 处理 ──────────────────────────────────────────────

// 设置相关
ipcMain.handle('settings:get', () => {
  return {
    apiKey: store.get('apiKey', ''),
    refreshInterval: store.get('refreshInterval', 60),
    panelResidenceSeconds: store.get('panelResidenceSeconds', 10),
    theme: store.get('theme', 'dark'),
    chartType: store.get('chartType', 'bar'),
    chartMode: store.get('chartMode', 'tokens'),
    opacity: store.get('opacity', 0.92),
    autoImportFolder: store.get('autoImportFolder', ''),
    apiFilter: store.get('apiFilter', '__all__'),
    autoExportEnabled: store.get('autoExportEnabled', false),
    autoExportInterval: store.get('autoExportInterval', 300),
    hasApiKey: !!store.get('apiKey', ''),
    hasCachedData: !!store.get('cachedDashboard')
  };
});

ipcMain.handle('settings:save', (event, data) => {
  if (data.apiKey !== undefined) store.set('apiKey', data.apiKey);
  if (data.refreshInterval !== undefined) store.set('refreshInterval', data.refreshInterval);
  if (data.panelResidenceSeconds !== undefined) store.set('panelResidenceSeconds', data.panelResidenceSeconds);
  if (data.theme !== undefined) store.set('theme', data.theme);
  if (data.chartType !== undefined) store.set('chartType', data.chartType);
  if (data.chartMode !== undefined) store.set('chartMode', data.chartMode);
  if (data.opacity !== undefined) {
    store.set('opacity', data.opacity);
    applyPanelOpacity(data.opacity);
  }
  if (data.autoImportFolder !== undefined) {
    store.set('autoImportFolder', data.autoImportFolder);
  }
  if (data.apiFilter !== undefined) {
    store.set('apiFilter', data.apiFilter);
  }
  if (data.autoExportEnabled !== undefined) {
    store.set('autoExportEnabled', data.autoExportEnabled);
    autoExport.enabled = data.autoExportEnabled;
    if (data.autoExportEnabled) autoExport.start(); else autoExport.stop();
  }
  if (data.autoExportInterval !== undefined) {
    store.set('autoExportInterval', data.autoExportInterval);
    autoExport.intervalSec = data.autoExportInterval;
    if (autoExport.enabled) { autoExport.stop(); autoExport.start(); }
  }
  if (data.autoImportFolder !== undefined) {
    autoExport.importDir = data.autoImportFolder;
  }
  // 通知主面板即时生效
  sendToRenderer('settings:changed', data);
  return { success: true };
});

function applyPanelOpacity(opacity) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOpacity(opacity);
  }
  Object.values(detailWindows).forEach(w => {
    if (w && !w.isDestroyed()) w.setOpacity(opacity);
  });
}

ipcMain.handle('settings:clearCache', () => {
  store.delete('cachedDashboard');
  store.delete('cachedUsageRecords');
  return { success: true };
});

// 数据刷新
ipcMain.handle('data:refresh', async () => {
  await refreshData();
  return { success: true };
});

// 获取缓存数据
ipcMain.handle('data:getCached', () => {
  return store.get('cachedDashboard', null);
});

// 获取缓存的用量记录（用于图表）
ipcMain.handle('data:getCachedUsageRecords', () => {
  return store.get('cachedUsageRecords', []);
});

// 获取 API Key 名称列表
ipcMain.handle('data:getApiKeyNames', () => {
  return store.get('apiKeyNames', []);
});

// 自动导出操作
ipcMain.on('export:openLogin', () => autoExport.openLogin());
ipcMain.on('export:showWindow', () => autoExport.showWindow());
ipcMain.handle('export:getStatus', () => ({ status: autoExport.status, lastFile: autoExport.lastFile }));

// 浏览文件夹
ipcMain.handle('dialog:browseFolder', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择自动导入目录',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// CSV 导入
ipcMain.handle('import:selectFile', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择 DeepSeek Usage CSV 文件',
    filters: [
      { name: 'CSV / ZIP 文件', extensions: ['csv', 'zip'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  try {
    const importResult = await UsageCSVImporter.importFromPath(result.filePaths[0]);
    const records = importResult.records || importResult; // 兼容旧格式
    const apiKeyNames = importResult.apiKeyNames || [];

    // 替换旧记录
    store.set('cachedUsageRecords', records);

    // API Key 列表
    let apiList = [...apiKeyNames].sort();
    if (records.some(r => !r.apiKeyName && (r.totalTokens > 0 || r.costInCents > 0))) {
      if (!apiList.includes('Unknown')) apiList.push('Unknown');
    }
    store.set('apiKeyNames', apiList);

    // 写入缓存
    const usageData = { data: records };
    store.set('cachedDashboard', { ...store.get('cachedDashboard', {}), usage: usageData, timestamp: Date.now() });
    sendToRenderer('data:imported', { usage: usageData, count: records.length, apiKeyNames: apiList });

    return { success: true, count: merged.length };
  } catch (err) {
    return { error: err.message };
  }
});

// 面板交互
ipcMain.on('panel:mouseEnter', () => {
  mouseOnPanel = true;
  clearAutoCloseTimer();
  if (mainWindow) sendToRenderer('panel:hoverState', true);
});

ipcMain.on('panel:mouseLeave', () => {
  mouseOnPanel = false;
  if (!mouseOnDetail) {
    startAutoCloseTimer();
  }
  if (mainWindow) sendToRenderer('panel:hoverState', false);
});

ipcMain.on('panel:close', () => closePanel());
ipcMain.on('panel:toggle', () => togglePanel());
ipcMain.on('panel:openSettings', () => openSettings());
ipcMain.on('panel:openDetail', (event, model) => openDetailWindow(model));
ipcMain.on('panel:pin', () => {
  panelPinned = !panelPinned;
  if (panelPinned) {
    clearAutoCloseTimer();
    if (mainWindow) mainWindow.setAlwaysOnTop(true);
  } else {
    startAutoCloseTimer();
  }
  sendToRenderer('panel:pinnedState', panelPinned);
});
ipcMain.handle('panel:getPinned', () => panelPinned);

// 详情窗口
ipcMain.on('detail:mouseEnter', () => { mouseOnDetail = true; clearAutoCloseTimer(); });
ipcMain.on('detail:mouseLeave', () => { mouseOnDetail = false; startAutoCloseTimer(); });
ipcMain.on('detail:close', (event, modelKey) => closeDetailWindow(modelKey));

// ── 工具函数 ──────────────────────────────────────────────
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
  Object.values(detailWindows).forEach(w => {
    if (w && !w.isDestroyed()) w.webContents.send(channel, data);
  });
}

async function importFileFromPath(filePath) {
  try {
    const { UsageCSVImporter } = require('./src/csv-import');
    const importResult = await UsageCSVImporter.importFromPath(filePath);
    const records = importResult.records || importResult;
    if (records.length > 0) {
      store.set('cachedUsageRecords', records);
      let apiList = [...(importResult.apiKeyNames || [])].sort();
      if (records.some(r => !r.apiKeyName && (r.totalTokens > 0 || r.costInCents > 0))) {
        if (!apiList.includes('Unknown')) apiList.push('Unknown');
      }
      store.set('apiKeyNames', apiList);
      const usageData = { data: records };
      store.set('cachedDashboard', { ...store.get('cachedDashboard', {}), usage: usageData, timestamp: Date.now() });
      sendToRenderer('data:imported', { usage: usageData, count: records.length, apiKeyNames: apiList });
    }
  } catch (e) { console.error('Auto import failed:', e.message); }
}

function cleanup() {
  clearAutoCloseTimer();
  autoImport.stop();
  autoExport.stop();
  autoExport.closeWindow();
  closeDetailWindow(); // 关闭所有详情
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
}

// ── 定时刷新 ──────────────────────────────────────────────
let refreshTimer = null;

function scheduleAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  const interval = store.get('refreshInterval', 60);
  const apiKey = store.get('apiKey', '');
  if (!apiKey) return;
  refreshTimer = setInterval(refreshData, interval * 1000);
}

// 监听 API Key 变更来重启定时器
store.onDidChange('apiKey', () => {
  scheduleAutoRefresh();
  const apiKey = store.get('apiKey', '');
  if (apiKey) refreshData();
});

store.onDidChange('refreshInterval', () => {
  scheduleAutoRefresh();
});

// ── 启动时自动导入 ──────────────────────────────────────
async function startupAutoImport() {
  const folder = store.get('autoImportFolder', '');
  if (!folder) return;
  try {
    if (!fs.existsSync(folder)) return;
    const files = fs.readdirSync(folder).filter(f =>
      f.toLowerCase().endsWith('.csv') || f.toLowerCase().endsWith('.zip')
    );
    if (files.length === 0) return;
    const { UsageCSVImporter } = require('./src/csv-import');
    for (const file of files) {
      const filePath = path.join(folder, file);
      try {
        const importResult = await UsageCSVImporter.importFromPath(filePath);
        const records = importResult.records || importResult;
        if (records.length > 0) {
          store.set('cachedUsageRecords', records);
          let apis = [...(importResult.apiKeyNames || [])].sort();
          if (records.some(r => !r.apiKeyName && (r.totalTokens > 0 || r.costInCents > 0))) {
            if (!apis.includes('Unknown')) apis.push('Unknown');
          }
          store.set('apiKeyNames', apis);
          const usageData = { data: records };
          store.set('cachedDashboard', { ...store.get('cachedDashboard', {}), usage: usageData, timestamp: Date.now() });
          sendToRenderer('data:imported', { usage: usageData, count: records.length, apiKeyNames: apis });
          break;
        }
      } catch (e) { /* skip */ }
    }
  } catch (e) { /* skip */ }
}

module.exports = { closePanel, refreshData, openSettings };
