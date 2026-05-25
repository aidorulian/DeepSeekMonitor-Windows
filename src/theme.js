// DeepSeek 品牌色 + UI 常量
// 对应 macOS 版 Theme.swift

const THEME = {
  // 面板尺寸
  panelWidth: 356,
  panelHeight: 500,
  panelCornerRadius: 22,
  panelTopGap: 8,
  detailPanelWidth: 420,

  // 品牌色
  brand: '#4D6BFE',
  brandLight: '#6A85FF',
  brandDark: '#3A52D6',
  brandFaint: 'rgba(77, 107, 254, 0.08)',

  // 模型颜色
  flash: '#3B82F6',
  flashGradient: 'linear-gradient(135deg, #3B82F6, #06B6D4)',
  pro: '#8B5CF6',
  proGradient: 'linear-gradient(135deg, #8B5CF6, #6366F1)',

  // 品牌渐变
  brandGradient: 'linear-gradient(135deg, #4D6BFE, #6A85FF)',

  // 卡片
  cardBgLight: 'rgba(248, 250, 252, 0.92)',
  cardBgDark: 'rgba(30, 32, 38, 0.94)',
  panelBgLight: 'rgba(245, 247, 250, 0.90)',
  panelBgDark: 'rgba(22, 24, 28, 0.88)',

  // 文本
  textPrimaryLight: '#1E293B',
  textPrimaryDark: '#F1F5F9',
  textSecondaryLight: '#64748B',
  textSecondaryDark: '#94A3B8',

  // 图表
  chartBarGradient: (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, ctx.chartArea?.bottom || 400);
    g.addColorStop(0, 'rgba(77, 107, 254, 0.7)');
    g.addColorStop(1, 'rgba(77, 107, 254, 0.15)');
    return g;
  }
};

// 模型定义
const MODELS = {
  flash: {
    rawValue: 'deepseek-chat',
    displayName: 'V4 Flash',
    shortName: 'Flash',
    icon: '⚡',
    color: THEME.flash,
    gradient: THEME.flashGradient,
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 2.0
  },
  pro: {
    rawValue: 'deepseek-reasoner',
    displayName: 'V4 Pro',
    shortName: 'Pro',
    icon: '🧠',
    color: THEME.pro,
    gradient: THEME.proGradient,
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 8.0
  }
};

function getModelInfo(modelName) {
  const normalized = (modelName || '').toLowerCase();
  if (normalized.includes('reasoner') || normalized.includes('pro')) return MODELS.pro;
  if (normalized.includes('chat') || normalized.includes('flash')) return MODELS.flash;
  return null;
}

// 格式化数字
function formatNumber(n) {
  if (n == null || isNaN(n)) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

// 格式化金额
function formatCost(cents) {
  const yuan = (cents || 0) / 100;
  return '¥' + yuan.toFixed(2);
}

// 格式化金额（大号）
function formatBalance(yuan) {
  return '¥' + (yuan || 0).toFixed(2);
}

module.exports = { THEME, MODELS, getModelInfo, formatNumber, formatCost, formatBalance };
