# DeepSeek Monitor for Windows

> 🖥️ Windows 系统托盘工具 — 实时监控 DeepSeek API Token 消耗与费用

基于 [JayHome137/DeepSeekMonitor](https://github.com/JayHome137/DeepSeekMonitor)（macOS SwiftUI 原版），使用 Electron 完整重建为 Windows 原生体验，并在此基础上进行了大量功能增强。

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey)

## 🚀 相比原版新增功能

- **分 API Key 展示** — 趋势图支持按 API Key 拆分为多色折线/柱状图，每个 Key 独立追踪
- **Token / 费用双模式** — 图表一键切换显示 Token 消耗量或 ¥ 费用金额
- **缓存命中率分析** — 详情窗口展示每日缓存命中/未命中 Token 堆叠图 + 命中率折线图
- **API 请求次数统计** — 按日统计每个模型的 API 调用次数
- **浅色/深色主题** — 全局切换，设置项即时生效无需重启
- **窗口透明度调节** — 滑块控制面板透明度
- **面板固定模式** — 支持将浮动面板固定在桌面上不自动消失
- **自动导入目录** — 设置监控目录，新增 CSV/ZIP 自动导入，启动时自动扫描
- **自动网页导出** — 模拟浏览器自动登录 DeepSeek 平台并触发用量导出（实验性）
- **柱状图/折线图切换** — 趋势图两种图表类型随意切换
- **Unknown API 追踪** — 已删除的 API Key 消费记录自动归类为 Unknown 展示
- **智能 CSV 解析** — 自动识别 amount/cost 两种导出格式，兼容中英文列名

## 📸 截图

### 主面板
![主面板](assets/1.png)

### 模型详情
![模型详情](assets/2.png)

## 📦 安装

### 从源码运行

```bash
git clone https://github.com/aidorulian/DeepSeekMonitor-Windows.git
cd DeepSeekMonitor-Windows
npm install
npm start
```

### 构建安装包

```bash
npm run build
# 输出在 dist/DeepSeek Monitor Setup x.x.x.exe
```

## 📖 使用

1. 点击系统托盘 DeepSeek 图标 → 右键 **设置**
2. 输入 [DeepSeek API Key](https://platform.deepseek.com/api_keys) → 点击「验证并保存」
3. 配置**自动导入目录**（如 `D:\Downloads`）
4. 从 DeepSeek Usage 页面导出 **amount 格式**的 ZIP 放入该目录，自动导入
5. 面板实时显示余额 + Token 用量 + 趋势图

### 自动网页导出（实验性）

1. 设置 → 自动网页导出 → 勾选启用 + 设置频率
2. 点击「打开登录页面」→ 在弹出的浏览器中登录 DeepSeek（仅首次，cookie 持久化）
3. 之后软件按设定频率自动访问 usage 页面、点击导出、下载到导入目录、自动导入

## 📊 CSV 格式说明

DeepSeek Usage 页面导出 ZIP 包含两个文件：

| 文件 | 内容 |
|---|---|
| `amount-*.csv` | **推荐** — Token 明细（按类型、API Key 分列，含缓存命中/未命中） |
| `cost-*.csv` | 账单汇总（仅有费用，无 Token 明细，无 API Key 信息） |

软件优先解析 amount CSV（完整 Token + API Key + 缓存信息）。仅当没有 amount 时才会使用 cost CSV（显示为 "Unknown"）。

## 🛠 技术栈

- **Electron 33** — 桌面框架
- **Chart.js** — 趋势图表（柱状图/折线图/堆叠图）
- **electron-store** — 本地持久化（JSON）

## 🙏 致谢

本项目基于 [JayHome137/DeepSeekMonitor](https://github.com/JayHome137/DeepSeekMonitor) 的 macOS 版设计和核心逻辑（CSV 解析、用量聚合算法、自动导出 JS 注入脚本），使用 Electron 完整重建为 Windows 应用，并新增了分 API 展示、Token/费用双模式、缓存命中率分析、主题切换、透明度调节等功能。

## 📄 许可证

MIT — 与 [原版](https://github.com/JayHome137/DeepSeekMonitor/blob/main/LICENSE) 保持一致
