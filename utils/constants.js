// 版本号：每次发版改这里
const APP_VERSION = '1.9.85'

// 公共常量与小工具

// 箱型（按本厂常用程度排序）
const BOX_TYPES = ['普通方箱', '水箱', '梯形箱', '连体', '包盖', '小盒', '异型箱']

// 需要模切的箱型
const DIE_CUT_BOX_TYPES = ['梯形箱', '连体', '包盖', '异型箱', '小盒']

// 工艺：草箱 = 直接用纸板；彩箱 = 面纸先彩印覆膜，再裱到纸板上
const CRAFTS = ['草箱', '彩箱']

// 面纸颜色（草箱用）
const PAPER_COLORS = ['黄面', '白面']

// 楞型（本厂主做 5 层 BA / BC，排在最前）
const FLUTES = ['五层 BA 瓦', '五层 BC 瓦', '三层 B 瓦', '三层 C 瓦', '三层 E 瓦', '五层 BE 瓦', '七层']

// 垫片类型
const PAD_TYPES = ['3层', '5层', '蜂窝']

// 需要录入数量的工序
// 只有这两道工序要填数量，其余工序点「开始 / 完成」即可，数量自动跟随
// 纸板到货、面纸印刷、代工（成品箱回来多少）要填数量；代印刷等其他工序点完成即可
const QTY_STEPS = ['纸板到货', '面纸印刷', '代工']

// 采购物料类型（供应商按类型匹配）
const MATERIAL_TYPES = ['面纸', '纸板', '胶水', '胶带', '油墨', '膜', '其他']

// 代工类型：代工厂本质也是供应商
const SERVICE_TYPES = ['代印', '成品箱']

// 模具 / 制版
const MOLD_TYPES = ['平模', '圆模', '印版']

// 供应商可勾选的全部类型（加工/制版在前，物料在后）
const SUPPLIER_TYPES = SERVICE_TYPES.concat(MOLD_TYPES, MATERIAL_TYPES)

// 工序总表（1.9.8：不再有 材质 / 钉粘 / 打包）
const STEPS = [
  '纸板到货', '面纸印刷', '裱纸',
  '生产', '代印刷',
  '代工'
]

// 草箱 / 彩箱 的默认工序
const DEFAULT_STEPS = {
  草箱: ['纸板到货', '生产'],
  彩箱: ['纸板到货', '面纸印刷', '裱纸']
}

// 机器最大进纸宽度（mm），纸板长超过需两片成型
const MAX_FEED_WIDTH = 2450

// 常备预警阈值（个）：常备款现有库存 ≤ 这个数就预警，提示补货到该水平
const STOCK_ALERT_THRESHOLD = 300

// 按工艺取进纸上限：彩箱走小机器 1600，草箱 2450
function feedLimit(craft) {
  return craft === '彩箱' ? 1600 : MAX_FEED_WIDTH
}

// 箱舌：水箱、小盒没有箱舌，其余 48
function defaultTang(boxType) {
  if (boxType === '水箱' || boxType === '小盒') return 38
  return 48
}

// 纸板尺寸计算
// 一片：长 = (长 + 宽) × 2 + 箱舌；宽 = 宽 + 高 + 4
// 两片：单张长 = 长 + 宽 + 箱舌；宽 = 宽 + 高 + 4（共 2 张）
function calcBoard(l, w, h, tang, craft) {
  const L = Number(l) || 0
  const W = Number(w) || 0
  const H = Number(h) || 0
  const T = Number(tang) || 0
  if (!L || !W || !H) return { length: 0, width: 0, twoPiece: false }
  const boardWidth = W + H + 4
  const onePiece = (L + W) * 2 + T
  const limit = feedLimit(craft)
  if (onePiece > limit) {
    return { length: L + W + T, width: boardWidth, twoPiece: true }
  }
  return { length: onePiece, width: boardWidth, twoPiece: false }
}

function needTwoPiece(l, w, h, tang, craft) {
  return calcBoard(l, w, h, tang, craft).twoPiece
}

// 自动生成工序
// 彩箱本厂：纸板到货 → 面纸印刷 → 裱纸
// 草箱本厂：纸板到货 → 生产
// 代印：纸板到货 → 代印刷
// 成品箱：只有「代工」
function autoSteps(opts) {
  const craft = opts.craft || '草箱'
  let mode = (opts.outsource && opts.outsource.mode) || ''
  if (craft === '彩箱' && mode === '代印') mode = ''   // 彩箱与代印互斥

  if (mode === '成品箱') return ['代工']
  if (craft === '彩箱') return ['纸板到货', '面纸印刷', '裱纸']
  return ['纸板到货', mode === '代印' ? '代印刷' : '生产']
}

function buildSteps(opts) {
  const steps = autoSteps(opts)
  if (opts.outsource && opts.outsource.mode === '成品箱') return ['代工']
  return steps.sort((a, b) => STEPS.indexOf(a) - STEPS.indexOf(b))
}

function defaultSteps(craft) {
  return (DEFAULT_STEPS[craft] || DEFAULT_STEPS['草箱']).slice()
}

// 把任意来源的工序整理成合规的：水印→生产、去掉已删除的工序、去重、按总表排序
function normalizeSteps(steps) {
  const RENAME = { 水印: '生产' }
  const out = []
  ;(steps || []).forEach(raw => {
    const isObj = raw && typeof raw === 'object'
    const name = RENAME[isObj ? raw.name : raw] || (isObj ? raw.name : raw)
    if (!name || STEPS.indexOf(name) === -1) return
    if (out.some(x => (isObj ? x.name : x) === name)) return
    out.push(isObj ? Object.assign({}, raw, { name }) : name)
  })
  return out.sort((a, b) => {
    const na = a && typeof a === 'object' ? a.name : a
    const nb = b && typeof b === 'object' ? b.name : b
    return STEPS.indexOf(na) - STEPS.indexOf(nb)
  })
}

module.exports = {
  APP_VERSION,
  BOX_TYPES,
  DIE_CUT_BOX_TYPES,
  CRAFTS,
  PAPER_COLORS,
  FLUTES,
  PAD_TYPES,
  QTY_STEPS,
  MATERIAL_TYPES,
  SERVICE_TYPES,
  SUPPLIER_TYPES,
  STEPS,
  MAX_FEED_WIDTH,
  STOCK_ALERT_THRESHOLD,
  feedLimit,
  defaultTang,
  calcBoard,
  autoSteps,
  buildSteps,
  needTwoPiece,
  defaultSteps,
  normalizeSteps
}
