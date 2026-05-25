// 自动导出服务 — 模拟浏览器访问 DeepSeek Usage 页面，自动触发导出下载
// 对应 macOS 版 UsageExportAutomationService.swift

const { BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

const USAGE_URL = 'https://platform.deepseek.com/usage';
const LOGIN_URL = 'https://platform.deepseek.com/sign_in';

// ── JS 注入脚本（平台无关，直接复用原版逻辑）───────────────
const CLICK_SCRIPT = `
(() => {
  const norm = v => (v || '').replace(/\\s+/g, ' ').trim();
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const textOf = el => norm([el.innerText, el.textContent, el.getAttribute?.('aria-label'), el.getAttribute?.('title')].filter(Boolean).join(' '));
  const contextOf = el => { const p=[]; let c=el; for(let i=0;c&&i<5;i++){const t=textOf(c);if(t)p.push(t);c=c.parentElement} return norm(p.join(' | ')); };

  const activate = el => {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const r = el.getBoundingClientRect();
    const pt = { clientX: Math.max(1,Math.min(innerWidth-1,r.left+r.width/2)), clientY: Math.max(1,Math.min(innerHeight-1,r.top+r.height/2)), bubbles:true, cancelable:true, composed:true, button:0, buttons:1 };
    if (typeof el.focus === 'function') el.focus();
    for (const t of ['pointerover','mouseover','pointerenter','mouseenter','pointerdown','mousedown','pointerup','mouseup','click']) {
      el.dispatchEvent(new (t.startsWith('pointer')&&typeof PointerEvent!=='undefined'?PointerEvent:MouseEvent)(t, pt));
    }
    if (typeof el.click === 'function') el.click();
    return true;
  };

  const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], span, div')).filter(visible);
  const passwordField = document.querySelector('input[type="password"]');

  // 评分找导出按钮
  const ranked = candidates.map(el => {
    const text = textOf(el), role = (el.getAttribute?.('role')||'').toLowerCase(), tag = (el.tagName||'').toLowerCase(), ctx = contextOf(el);
    let s = 0;
    if (role === 'button') s += 80;
    if (tag === 'button') s += 60;
    if (text === '导出') s += 200;
    if (text.includes('导出')) s += 80;
    if (text.toLowerCase().includes('export')) s += 40;
    if (ctx.includes('每月用量')) s += 160;
    if (ctx.toLowerCase().includes('usage')) s += 20;
    if (ctx.includes('设置')) s -= 40;
    return { el, score: s };
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score);

  const best = ranked[0];
  if (best && best.el) {
    activate(best.el);
    return { clicked: true, needsLogin: false, text: textOf(best.el), score: best.score };
  }
  return { clicked: false, needsLogin: !!passwordField || /sign_in|login/i.test(location.href) };
})();
`;

const FOLLOWUP_SCRIPT = `
(() => {
  const norm = v => (v || '').replace(/\\s+/g, ' ').trim();
  const visible = el => { const r=el.getBoundingClientRect(),s=window.getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
  const textOf = el => norm([el.innerText,el.textContent,el.getAttribute?.('aria-label'),el.getAttribute?.('title')].filter(Boolean).join(' '));
  const activate = el => {
    if(!el)return false; try{el.scrollIntoView({block:'center',inline:'center'})}catch{}
    const r=el.getBoundingClientRect(),pt={clientX:Math.max(1,Math.min(innerWidth-1,r.left+r.width/2)),clientY:Math.max(1,Math.min(innerHeight-1,r.top+r.height/2)),bubbles:true,cancelable:true,composed:true,button:0,buttons:1};
    if(typeof el.focus==='function')el.focus();
    for(const t of['pointerover','mouseover','pointerenter','mouseenter','pointerdown','mousedown','pointerup','mouseup','click'])el.dispatchEvent(new(t.startsWith('pointer')&&typeof PointerEvent!=='undefined'?PointerEvent:MouseEvent)(t,pt));
    if(typeof el.click==='function')el.click();return true;
  };
  const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], li, span, div')).filter(visible);
  const exact = nodes.find(el => { const t=textOf(el); return (el.getAttribute?.('role')||'').toLowerCase()==='button' && t==='导出'; });
  if (exact) { activate(exact); return { clicked: true }; }
  for (const kw of ['下载','确认','zip','csv','amount','导出']) {
    const t = nodes.find(el => textOf(el).toLowerCase().includes(kw.toLowerCase()));
    if (t) { activate(t); return { clicked: true, keyword: kw }; }
  }
  return { clicked: false };
})();
`;

// ── 导出服务 ──────────────────────────────────────────────
class UsageExportAutomation {
  constructor() {
    this.win = null;
    this.enabled = false;
    this.intervalSec = 300; // 默认 5 分钟
    this.timer = null;
    this.downloadWatch = null;
    this.lastAttempt = null;
    this.exportTriggeredAt = null;
    this.watchAttempts = 0;
    this.status = '未启动';
    this.lastFile = null;
    this.onDownloadReady = null; // 回调: (filePath) => void
    this.importDir = '';
  }

  start() {
    if (this.timer) return;
    this.status = '运行中';
    this.timer = setInterval(() => this.tick(), this.intervalSec * 1000);
    // 启动后 5 秒执行首次
    setTimeout(() => this.tick(), 5000);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.downloadWatch) { clearInterval(this.downloadWatch); this.downloadWatch = null; }
    this.status = '已停止';
  }

  closeWindow() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.hide();
    }
  }

  async tick() {
    if (!this.enabled) return;
    if (this.lastAttempt && Date.now() - this.lastAttempt < 25000) return;
    this.lastAttempt = Date.now();

    const win = await this.ensureWindow();
    const currentURL = win.webContents.getURL();

    if (currentURL.includes('/usage')) {
      this.status = '正在点击导出...';
      await win.webContents.executeJavaScript(CLICK_SCRIPT).then(result => {
        if (result.clicked) {
          this.status = `已触发 ${result.text || '导出'}，等待下载...`;
          this.exportTriggeredAt = Date.now();
          this.startDownloadWatch();
          // 1 秒后补刀
          setTimeout(() => {
            if (this.win && !this.win.isDestroyed()) {
              this.win.webContents.executeJavaScript(FOLLOWUP_SCRIPT).catch(() => {});
            }
          }, 1000);
        } else if (result.needsLogin) {
          this.status = '需要登录 DeepSeek 平台';
          this.showWindow();
        } else {
          this.status = '正在等待页面加载...';
          setTimeout(() => this.retryClick(), 1500);
        }
      }).catch(e => {
        this.status = 'JS 注入失败: ' + e.message;
      });
    } else {
      this.status = '正在打开用量页面...';
      win.loadURL(USAGE_URL);
      // 等页面加载后再试
      setTimeout(() => this.retryClick(), 4000);
    }
  }

  retryClick() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.executeJavaScript(CLICK_SCRIPT).then(result => {
      if (result.clicked) {
        this.status = '已触发导出';
        this.exportTriggeredAt = Date.now();
        this.startDownloadWatch();
      }
    }).catch(() => {});
  }

  startDownloadWatch() {
    if (this.downloadWatch) clearInterval(this.downloadWatch);
    this.watchAttempts = 0;
    this.downloadWatch = setInterval(() => this.checkForDownload(), 1500);
  }

  checkForDownload() {
    this.watchAttempts++;
    // 检查导入目录是否有新文件
    if (this.importDir) {
      try {
        const files = fs.readdirSync(this.importDir).filter(f => {
          const ext = path.extname(f).toLowerCase();
          return ext === '.csv' || ext === '.zip';
        }).map(f => ({ name: f, mtime: fs.statSync(path.join(this.importDir, f)).mtimeMs }))
        .filter(f => f.mtime > (this.exportTriggeredAt || 0) - 2000)
        .sort((a, b) => b.mtime - a.mtime);

        if (files.length > 0) {
          const filePath = path.join(this.importDir, files[0].name);
          this.status = `已下载: ${files[0].name}`;
          this.lastFile = files[0].name;
          if (this.downloadWatch) { clearInterval(this.downloadWatch); this.downloadWatch = null; }
          if (this.onDownloadReady) this.onDownloadReady(filePath);
          return;
        }
      } catch (e) { /* ignore */ }
    }

    // 超时
    if (this.watchAttempts >= 15) {
      if (this.downloadWatch) { clearInterval(this.downloadWatch); this.downloadWatch = null; }
      this.status = '导出超时，可能需要手动确认';
      // 再补一刀
      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.executeJavaScript(FOLLOWUP_SCRIPT).catch(() => {});
      }
    }
  }

  async ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win;

    this.win = new BrowserWindow({
      width: 1100,
      height: 800,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:deepseek-export' // 持久化 cookie
      }
    });

    // 拦截下载
    this.win.webContents.session.on('will-download', (event, item) => {
      const filename = item.getFilename();
      if (filename && (filename.endsWith('.zip') || filename.endsWith('.csv'))) {
        if (this.importDir) {
          const destPath = path.join(this.importDir, filename);
          item.setSavePath(destPath);
          item.on('done', (event, state) => {
            if (state === 'completed') {
              this.status = `下载完成: ${filename}`;
              this.lastFile = filename;
              if (this.downloadWatch) { clearInterval(this.downloadWatch); this.downloadWatch = null; }
              if (this.onDownloadReady) this.onDownloadReady(destPath);
            }
          });
        }
      }
    });

    this.win.loadURL(USAGE_URL);
    return this.win;
  }

  showWindow() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
    }
  }

  openLogin() {
    const win = this.ensureWindow();
    win.then(w => {
      w.loadURL(LOGIN_URL);
      w.show();
      w.focus();
    });
  }
}

module.exports = { UsageExportAutomation };
