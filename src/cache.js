// electron-store 缓存封装
// 对应 macOS 版 LocalCache.swift + UserDefaults

const Store = require('electron-store');

let storeInstance = null;

function getCacheStore() {
  if (!storeInstance) {
    storeInstance = new Store({
      name: 'deepseek-monitor-cache',
      defaults: {
        apiKey: '',
        refreshInterval: 60,
        panelResidenceSeconds: 10,
        cachedDashboard: null,
        cachedUsageRecords: [],
        importedFileHashes: []
      }
    });
  }
  return storeInstance;
}

/**
 * 保存 Dashboard 快照到缓存
 */
function saveDashboard(store, data) {
  store.set('cachedDashboard', {
    ...data,
    timestamp: Date.now()
  });
}

/**
 * 读取 Dashboard 缓存
 */
function loadDashboard(store) {
  const cached = store.get('cachedDashboard');
  if (!cached) return null;
  return cached;
}

/**
 * 保存用量记录
 */
function saveUsageRecords(store, records) {
  store.set('cachedUsageRecords', records);
}

/**
 * 读取用量记录
 */
function loadUsageRecords(store) {
  return store.get('cachedUsageRecords', []);
}

/**
 * 清除所有缓存
 */
function clearAllCache(store) {
  store.set('cachedDashboard', null);
  store.set('cachedUsageRecords', []);
  store.set('importedFileHashes', []);
}

/**
 * 检查文件是否已导入
 */
function isFileImported(store, hash) {
  const hashes = store.get('importedFileHashes', []);
  return hashes.includes(hash);
}

/**
 * 标记文件已导入
 */
function markFileImported(store, hash) {
  const hashes = store.get('importedFileHashes', []);
  if (!hashes.includes(hash)) {
    hashes.push(hash);
    // 只保留最近 100 个
    if (hashes.length > 100) hashes.shift();
    store.set('importedFileHashes', hashes);
  }
}

module.exports = {
  getCacheStore,
  saveDashboard,
  loadDashboard,
  saveUsageRecords,
  loadUsageRecords,
  clearAllCache,
  isFileImported,
  markFileImported
};
