const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deepseekAPI', {
  // ── 设置 ──
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  clearCache: () => ipcRenderer.invoke('settings:clearCache'),

  // ── 数据 ──
  refreshData: () => ipcRenderer.invoke('data:refresh'),
  getCachedDashboard: () => ipcRenderer.invoke('data:getCached'),
  getCachedUsageRecords: () => ipcRenderer.invoke('data:getCachedUsageRecords'),
  getApiKeyNames: () => ipcRenderer.invoke('data:getApiKeyNames'),

  // ── 导入 ──
  importCSV: () => ipcRenderer.invoke('import:selectFile'),
  browseFolder: () => ipcRenderer.invoke('dialog:browseFolder'),
  openLoginPage: () => ipcRenderer.send('export:openLogin'),
  getExportStatus: () => ipcRenderer.invoke('export:getStatus'),

  // ── 面板 ──
  onPanelMouseEnter: () => ipcRenderer.send('panel:mouseEnter'),
  onPanelMouseLeave: () => ipcRenderer.send('panel:mouseLeave'),
  closePanel: () => ipcRenderer.send('panel:close'),
  openSettings: () => ipcRenderer.send('panel:openSettings'),
  openDetail: (model) => ipcRenderer.send('panel:openDetail', model),
  togglePin: () => ipcRenderer.send('panel:pin'),
  getPinned: () => ipcRenderer.invoke('panel:getPinned'),

  // ── 详情窗口 ──
  onDetailMouseEnter: () => ipcRenderer.send('detail:mouseEnter'),
  onDetailMouseLeave: () => ipcRenderer.send('detail:mouseLeave'),
  closeDetail: (model) => ipcRenderer.send('detail:close', model),

  // ── 事件监听 ──
  onDataResult: (callback) => {
    ipcRenderer.on('data:result', (_event, data) => callback(data));
  },
  onDataLoading: (callback) => {
    ipcRenderer.on('data:loading', (_event, loading) => callback(loading));
  },
  onHoverState: (callback) => {
    ipcRenderer.on('panel:hoverState', (_event, hovering) => callback(hovering));
  },
  onDataImported: (callback) => {
    ipcRenderer.on('data:imported', (_event, data) => callback(data));
  },
  onPinnedState: (callback) => {
    ipcRenderer.on('panel:pinnedState', (_event, pinned) => callback(pinned));
  },
  onSettingsChanged: (callback) => {
    ipcRenderer.on('settings:changed', (_event, data) => callback(data));
  },

  // ── 移除监听 ──
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('data:result');
    ipcRenderer.removeAllListeners('data:loading');
    ipcRenderer.removeAllListeners('panel:hoverState');
    ipcRenderer.removeAllListeners('data:imported');
    ipcRenderer.removeAllListeners('panel:pinnedState');
    ipcRenderer.removeAllListeners('settings:changed');
  }
});
