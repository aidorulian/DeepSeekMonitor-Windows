// DeepSeek API 服务层
// 对应 macOS 版 DeepSeekService.swift
// 接口: GET /user/balance  +  GET /v1/usage

const BASE_URL = 'https://api.deepseek.com';

class APIError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'APIError';
  }

  static fromResponse(status, body) {
    switch (status) {
      case 401: return new APIError('unauthorized', 'API Key 无效或已过期');
      case 429: return new APIError('rate_limited', '请求过于频繁，请稍后重试');
      case 404: return new APIError('not_found', '接口不存在');
      default:
        if (status >= 500) return new APIError('server_error', `服务器错误 (${status})`);
        return new APIError('http_error', `HTTP 错误 (${status})`);
    }
  }
}

class UsageEndpointUnavailableError extends APIError {
  constructor() {
    super('usage_unavailable', 'DeepSeek 当前未公开用量查询接口，已仅显示余额');
  }
}

async function request(url, apiKey, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      signal: controller.signal,
      ...options
    });

    if (!resp.ok) {
      throw APIError.fromResponse(resp.status);
    }

    return await resp.json();
  } catch (err) {
    if (err instanceof APIError) throw err;
    if (err.name === 'AbortError') throw new APIError('timeout', '请求超时');
    throw new APIError('network', `网络错误: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 查询账户余额
 * GET https://api.deepseek.com/user/balance
 */
async function fetchBalance(apiKey) {
  const data = await request(`${BASE_URL}/user/balance`, apiKey);
  return {
    isAvailable: data.is_available,
    balanceInfos: (data.balance_infos || []).map(info => ({
      currency: info.currency,
      totalBalance: parseFloat(info.total_balance) || 0,
      grantedBalance: parseFloat(info.granted_balance) || 0,
      toppedUpBalance: parseFloat(info.topped_up_balance) || 0
    }))
  };
}

/**
 * 查询指定日期范围的用量
 * GET https://api.deepseek.com/v1/usage?start_date=&end_date=
 */
async function fetchUsage(apiKey, startDate, endDate) {
  const url = `${BASE_URL}/v1/usage?start_date=${startDate}&end_date=${endDate}`;
  try {
    const data = await request(url, apiKey);
    return {
      data: (data.data || []).map(record => ({
        id: record.id,
        modelName: record.model_name,
        totalTokens: record.total_tokens || 0,
        promptTokens: record.prompt_tokens || 0,
        inputCacheHitTokens: record.input_cache_hit_tokens || 0,
        inputCacheMissTokens: record.input_cache_miss_tokens || 0,
        completionTokens: record.completion_tokens || 0,
        costInCents: record.cost_in_cents || 0,
        date: record.date,
        requestCount: record.request_count || 0
      }))
    };
  } catch (err) {
    if (err instanceof APIError && err.code === 'not_found') {
      throw new UsageEndpointUnavailableError();
    }
    throw err;
  }
}

/**
 * 获取最近 N 天的用量
 */
async function fetchRecentUsage(apiKey, days = 7) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));

  const fmt = (d) => d.toISOString().split('T')[0];
  return fetchUsage(apiKey, fmt(startDate), fmt(endDate));
}

module.exports = { fetchBalance, fetchUsage, fetchRecentUsage, APIError, UsageEndpointUnavailableError };
