// 自动导入服务 — 监测下载目录中的新 CSV/ZIP 文件
// 对应 macOS 版 UsageAutoImportService.swift + DirectoryChangeMonitor.swift

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chokidar = require('chokidar');
const { getCacheStore, isFileImported, markFileImported } = require('./cache');

class UsageAutoImportService {
  constructor() {
    this.watcher = null;
    this.watchDirs = [];
    this.onNewFile = null; // 回调: (filePath) => void
  }

  /**
   * 获取监测目录列表
   */
  getWatchDirectories() {
    const dirs = [];

    // 用户下载目录
    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (home) {
      dirs.push(path.join(home, 'Downloads'));
    }

    // 应用数据目录 (usage-sync 文件夹)
    const appData = process.env.APPDATA ||
      (process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support')
        : path.join(home, '.config'));
    dirs.push(path.join(appData, 'DeepSeekMonitor', 'usage-sync'));

    // 确保 usage-sync 目录存在
    const syncDir = dirs[dirs.length - 1];
    try { fs.mkdirSync(syncDir, { recursive: true }); } catch {}

    return dirs.filter(d => {
      try { return fs.existsSync(d) && fs.statSync(d).isDirectory(); }
      catch { return false; }
    });
  }

  /**
   * 启动文件监测
   */
  start() {
    this.stop();

    this.watchDirs = this.getWatchDirectories();
    if (this.watchDirs.length === 0) return;

    this.watcher = chokidar.watch(this.watchDirs, {
      ignored: /(^|[\/\\])\../,  // 忽略隐藏文件
      persistent: true,
      ignoreInitial: true,
      depth: 1,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 500
      }
    });

    this.watcher.on('add', (filePath) => {
      this.handleNewFile(filePath);
    });

    // 也处理重命名（某些浏览器先写 .tmp 再重命名）
    this.watcher.on('change', (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.csv' || ext === '.zip') {
        this.handleNewFile(filePath);
      }
    });
  }

  /**
   * 停止监测
   */
  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.watchDirs = [];
  }

  /**
   * 处理新文件
   */
  handleNewFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.csv' && ext !== '.zip') return;

    // 文件名需包含 usage 或 deepseek 关键词（降低误触发）
    const basename = path.basename(filePath).toLowerCase();
    if (!basename.includes('usage') && !basename.includes('deepseek') && !basename.includes('用量')) {
      return;
    }

    // 去重检查
    try {
      const stat = fs.statSync(filePath);
      const hash = crypto
        .createHash('md5')
        .update(`${filePath}_${stat.size}_${stat.mtimeMs}`)
        .digest('hex');

      const store = getCacheStore();
      if (isFileImported(store, hash)) return;
      markFileImported(store, hash);
    } catch {
      return;
    }

    // 触发回调
    if (this.onNewFile) {
      this.onNewFile(filePath);
    }
  }
}

module.exports = { UsageAutoImportService };
