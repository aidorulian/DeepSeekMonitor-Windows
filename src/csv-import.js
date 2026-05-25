// CSV 解析器 — 支持 DeepSeek Usage 导出的账单 + Amount 格式
// 对应 macOS 版 UsageCSVImporter.swift

const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

// ── 列名标准化 ────────────────────────────────────────────
function normalizeHeader(raw) {
  let trimmed = (raw || '').trim();
  if (trimmed.charCodeAt(0) === 0xFEFF) trimmed = trimmed.slice(1);
  return trimmed
    .toLowerCase()
    .replace(/[_\- .()（）\/]/g, '');
}

// ── CSV 行解析 ────────────────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ── 工具 ──────────────────────────────────────────────────
function colIdx(headers, ...names) {
  const h = headers.map(normalizeHeader);
  for (const n of names) {
    const idx = h.indexOf(normalizeHeader(n));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseInteger(raw) {
  const s = String(raw || '').replace(/,/g, '').trim();
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

function parseFloatSafe(raw) {
  const s = String(raw || '0').replace(/,/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parsePriceCents(price, amount) {
  const p = parseFloatSafe(price);
  const a = parseInteger(amount);
  if (isNaN(p) || a <= 0) return 0;
  return Math.round(p * a * 100); // price is yuan per token, total = price * amount, convert to cents
}

function normModel(raw) {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('reasoner') || s.includes('pro') || s.includes('v4-pro')) return 'deepseek-reasoner';
  if (s.includes('chat') || s.includes('flash') || s.includes('v4-flash')) return 'deepseek-chat';
  return s || 'deepseek-chat';
}

function normDate(raw) {
  const s = (raw || '').trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  const m = s.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s.slice(0, 10);
}

// ── Amount CSV 解析（Token 明细格式）───────────────────────
// 格式: user_id, utc_date, model, api_key_name, api_key, type, price, amount
function parseAmountCSV(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('Amount CSV 为空');

  const headers = parseCSVLine(lines[0]);
  const dateIdx = colIdx(headers, 'utc_date', 'date', 'utcdate');
  const modelIdx = colIdx(headers, 'model');
  const apiNameIdx = colIdx(headers, 'api_key_name', 'apikeyname');
  const typeIdx = colIdx(headers, 'type');
  const priceIdx = colIdx(headers, 'price');
  const amountIdx = colIdx(headers, 'amount');

  if (dateIdx < 0 || modelIdx < 0 || typeIdx < 0 || amountIdx < 0) {
    throw new Error('Amount CSV 缺少必要列 (utc_date/model/type/amount)');
  }

  // 收集所有 API Key 名称
  const apiKeyNames = new Set();

  // 按 (date|model|apiKeyName) 聚合
  const agg = {}; // key → { promptTokens, inputCacheHitTokens, inputCacheMissTokens, completionTokens, totalTokens, costInCents, requestCount }

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < amountIdx + 1) continue;

    const date = normDate(cols[dateIdx]);
    const model = normModel(cols[modelIdx]);
    const apiName = (cols[apiNameIdx] || '').trim();
    const type = normalizeHeader(cols[typeIdx] || '');
    const price = cols[priceIdx] || '0';
    const amount = parseInteger(cols[amountIdx]);

    if (!date || !model) continue;
    if (apiName) apiKeyNames.add(apiName);

    const key = `${date}|${model}|${apiName}`;
    if (!agg[key]) {
      agg[key] = { promptTokens: 0, inputCacheHitTokens: 0, inputCacheMissTokens: 0, completionTokens: 0, totalTokens: 0, costInCents: 0, requestCount: 0 };
    }
    const a = agg[key];

    if (type.includes('requestcount')) {
      if (amount > 0) a.requestCount += amount;
      continue;
    }

    if (amount <= 0 && parseFloat(price) <= 0) continue;
    if (!type.includes('token')) continue;

    if (type.includes('outputtokens')) {
      a.completionTokens += amount;
    } else if (type.includes('inputcachehittokens')) {
      a.promptTokens += amount;
      a.inputCacheHitTokens += amount;
    } else if (type.includes('inputcachemisstokens')) {
      a.promptTokens += amount;
      a.inputCacheMissTokens += amount;
    } else {
      a.promptTokens += amount;
      a.inputCacheMissTokens += amount;
    }
    a.totalTokens += amount;
    a.costInCents += parsePriceCents(price, amount);
  }

  // 转为 UsageRecord 数组
  const records = [];
  for (const [key, a] of Object.entries(agg)) {
    const [date, model, apiName] = key.split('|');
    if (a.totalTokens <= 0 && a.costInCents <= 0 && a.requestCount <= 0) continue;
    records.push({
      id: key,
      modelName: model,
      totalTokens: a.totalTokens,
      promptTokens: a.promptTokens,
      inputCacheHitTokens: a.inputCacheHitTokens,
      inputCacheMissTokens: a.inputCacheMissTokens,
      completionTokens: a.completionTokens,
      costInCents: a.costInCents,
      date,
      requestCount: a.requestCount,
      apiKeyName: apiName || ''
    });
  }

  records.sort((a, b) => a.date.localeCompare(b.date) || a.modelName.localeCompare(b.modelName));
  return { records, apiKeyNames: [...apiKeyNames].sort() };
}

// ── 账单 CSV 解析（简单费用格式）───────────────────────────
// 格式: user_id, utc_date, model, wallet_type, cost, currency
function parseCostCSV(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('Cost CSV 为空');

  const headers = parseCSVLine(lines[0]);
  const dateIdx = colIdx(headers, 'utc_date', 'date', 'utcdate');
  const modelIdx = colIdx(headers, 'model');
  const costIdx = colIdx(headers, 'cost');

  if (dateIdx < 0 || modelIdx < 0) throw new Error('Cost CSV 缺少必要列');

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const date = normDate(cols[dateIdx]);
    const model = normModel(cols[modelIdx]);
    if (!date || !model) continue;
    const costYuan = parseFloat((cols[costIdx] || '0').replace(/,/g, ''));
    records.push({
      id: `${model}_${date}_${i}`,
      modelName: model,
      totalTokens: 0, promptTokens: 0, inputCacheHitTokens: 0,
      inputCacheMissTokens: 0, completionTokens: 0,
      costInCents: Math.round(costYuan * 100),
      date,
      requestCount: 0,
      apiKeyName: ''
    });
  }
  return { records, apiKeyNames: [] };
}

// ── 通用 CSV 解析（旧格式兼容）─────────────────────────────
function parseGenericCSV(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV 为空');

  const headers = parseCSVLine(lines[0]);
  const dateIdx = colIdx(headers, 'utc_date', 'date', 'utcdate', '日期');
  const modelIdx = colIdx(headers, 'model', 'model_name', '模型');
  const inputIdx = colIdx(headers, 'prompt_tokens', 'inputtokens', '输入token');
  const outputIdx = colIdx(headers, 'completion_tokens', 'outputtokens', '输出token');
  const totalIdx = colIdx(headers, 'total_tokens', 'totaltokens', '总token');
  const costIdx = colIdx(headers, 'amount', 'cost', 'fee', '费用', '金额');
  const reqIdx = colIdx(headers, 'request_count', 'requests', '请求次数');

  if (dateIdx < 0 || modelIdx < 0) throw new Error('CSV 缺少日期或模型列');

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length === 0) continue;
    const date = normDate(cols[dateIdx]);
    const model = normModel(cols[modelIdx]);
    if (!date || !model) continue;

    const promptTokens = parseInteger(cols[inputIdx]);
    const completionTokens = parseInteger(cols[outputIdx]);
    const totalTokens = Math.max(parseInteger(cols[totalIdx]), promptTokens + completionTokens);
    const requestCount = parseInteger(cols[reqIdx]);
    let costInCents = parsePriceCents(cols[costIdx], 1);
    if (!costInCents && costIdx >= 0) {
      const yuan = parseFloat((cols[costIdx] || '0').replace(/,/g, ''));
      if (!isNaN(yuan)) costInCents = Math.round(yuan * 100);
    }

    if (totalTokens <= 0 && costInCents <= 0 && requestCount <= 0) continue;

    records.push({
      id: `${model}_${date}_${i}`,
      modelName: model,
      totalTokens, promptTokens,
      inputCacheHitTokens: 0, inputCacheMissTokens: promptTokens,
      completionTokens,
      costInCents,
      date,
      requestCount,
      apiKeyName: ''
    });
  }
  return { records, apiKeyNames: [] };
}

// ── 智能检测并解析 ────────────────────────────────────────
function detectAndParse(content) {
  const firstLine = content.split(/\r?\n/)[0] || '';
  const headers = parseCSVLine(firstLine).map(normalizeHeader);

  // 检测 amount 格式: 有 type + amount 列
  const hasType = headers.some(h => h === 'type');
  const hasAmount = headers.some(h => h === 'amount');
  const hasApiKeyName = headers.some(h => h.includes('apikeyname') || h === 'api_key_name');

  if (hasType && hasAmount) {
    return parseAmountCSV(content);
  }
  // 检测简单账单格式
  const hasCost = headers.some(h => h === 'cost');
  const hasCurrency = headers.some(h => h === 'currency');
  if (hasCost && hasCurrency) {
    return parseCostCSV(content);
  }
  // fallback
  return parseGenericCSV(content);
}

// ── 主入口：从文件路径导入 ────────────────────────────────
async function importFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.zip') {
    const dir = await unzipper.Open.file(filePath);
    const csvFiles = dir.files.filter(f =>
      f.path.toLowerCase().endsWith('.csv') && !f.path.startsWith('__MACOSX')
    );

    if (csvFiles.length === 0) throw new Error('ZIP 中未找到 CSV 文件');

    let allRecords = [];
    let allApiNames = new Set();

    // 优先解析 amount CSV（包含 token 明细 + 费用）
    // amount CSV 的 price*amount 已经包含费用，无需再从 cost CSV 重复计算
    const amountFile = csvFiles.find(f => f.path.toLowerCase().includes('amount'));
    const costFile = csvFiles.find(f => f.path.toLowerCase().includes('cost'));
    const others = csvFiles.filter(f => f !== amountFile && f !== costFile);

    let hasAmountData = false;

    if (amountFile) {
      try {
        const content = (await amountFile.buffer()).toString('utf-8');
        const result = detectAndParse(content);
        allRecords = result.records;
        result.apiKeyNames.forEach(n => allApiNames.add(n));
        hasAmountData = result.records.length > 0;
      } catch (e) {
        console.error(`解析 ${amountFile.path} 失败:`, e.message);
      }
    }

    // Cost CSV：仅在无 amount 数据时作为主数据源（否则 amount 已含完整费用+API 名）
    if (!hasAmountData && costFile) {
      try {
        const content = (await costFile.buffer()).toString('utf-8');
        const result = detectAndParse(content);
        allRecords = result.records;
        result.apiKeyNames.forEach(n => allApiNames.add(n));
      } catch (e) {
        console.error(`解析 ${costFile.path} 失败:`, e.message);
      }
    }

    // 解析其他 CSV
    for (const f of others) {
      try {
        const content = (await f.buffer()).toString('utf-8');
        const result = detectAndParse(content);
        allRecords.push(...result.records);
        result.apiKeyNames.forEach(n => allApiNames.add(n));
      } catch (e) {
        console.error(`解析 ${f.path} 失败:`, e.message);
      }
    }

    return { records: allRecords, apiKeyNames: [...allApiNames].sort() };
  }

  if (ext === '.csv') {
    const content = fs.readFileSync(filePath, 'utf-8');
    return detectAndParse(content);
  }

  throw new Error(`不支持的文件格式: ${ext}`);
}

const UsageCSVImporter = { importFromPath };

module.exports = { UsageCSVImporter };
