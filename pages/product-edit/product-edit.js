const app = getApp()
const C = require('../../utils/constants.js')

Page({
  data: {
    fontClass: '',
    kbHeight: 0,
    footerBottom: 0,
    isIOS: false,
    mode: 'product',        // product | sample
    draftId: '',
    isEdit: false,
    id: '',
    name: '',

    crafts: C.CRAFTS,
    craftIndex: 0,
    paperColors: C.PAPER_COLORS,
    paperColorIndex: 0,

    boxTypes: C.BOX_TYPES,
    boxTypeIndex: 0,
    manualBoard: false,
    boards: [],
    // 纸板命名（多张纸板时：主纸板=大板、第2张=小板、第3张起=附加纸板A/B…）
    boardNames: [],

    sizeL: '',
    sizeW: '',
    sizeH: '',

    flutes: C.FLUTES,
    fluteIndex: 0,


    history: [],

    tang: 48,
    boardL: '',
    boardW: '',
    boardManual: false,
    formulaText: '',
    twoPiece: false,


    customers: [],
    selectedCustomers: [],

    steps: [],
    stockItem: false,
    stockAlertQty: 0,
    outsourceEnabled: false,
    outModes: ['代印', '成品箱'],
    outModeIndex: 0,
    outsourceMode: '',
    outsource: { mode: '', supplier: '' },
    supplierNames: [],
    supplierIndex: 0,
    stepOptions: [],

    creaseOptions: C.CREASES,
    creaseIndex: 0,
    crease: '',
    creaseValue: '',
    // 系列：勾选客户后才显示；可手输新建，也可点小三角从已有系列里选
    series: '',
    seriesOpen: false,
    seriesOptions: [],
    // 连体箱片数固定，无法自动拆片：纸板超过进纸上限时红字提示
    boardLimit: C.feedLimit('草箱'),
    overBoardText: '',
    padTypes: C.PAD_TYPES,
    pads: [],

    price: '',
    note: '',

    // 打样单专用
    customer: '',
    quantity: '',
    today: ''
  },

  onUnload() {
    if (this.kbHandler && wx.offKeyboardHeightChange) wx.offKeyboardHeightChange(this.kbHandler)
  },

  onLoad(options) {
    // 键盘弹起时隐藏底部按钮，避免输入框被挡
    const sys = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    this.setData({ isIOS: sys.platform === 'ios' })
    this.kbHandler = res => this.setData({ kbHeight: res.height, footerBottom: this.data.isIOS ? res.height : 0 })
    if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(this.kbHandler)

    const mode = (options && options.mode === 'sample') ? 'sample' : 'product'
    this.setData({ mode, today: app.today() })

    if (options && options.draftId) {
      const d = app.getDraft(options.draftId)
      if (d) {
        this.setData({ draftId: d.id })
        this.loadFrom(d)
      }
    } else if (options && options.id) {
      const p = app.getProduct(options.id)
      if (p) {
        this.setData({ isEdit: true })
        this.loadFrom(p)
        // 记住加载时的原始编号：保存时的重复检查要用它。
        // 以前直接用 this.data.id，用户把编号输入框改成别人的编号时
        // 「自己排除自己」导致检查失效，会静默覆盖已有产品
        this._originId = p.id
      }
    } else {
      this.setData({
        fluteIndex: 0,
        steps: C.defaultSteps('草箱'),
        tang: C.defaultTang(C.BOX_TYPES[0])
      }, () => this.refreshAll())
    }
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass() })
    this.syncOutsourceOptions()
    this.setData({ customers: app.getCustomers() }, () => this.refreshAll())
  },

  loadFrom(obj) {
    const craftIndex = Math.max(0, C.CRAFTS.indexOf(obj.craft || '草箱'))
    const flute = obj.flute || C.FLUTES[0]
    const fluteIndex = Math.max(0, C.FLUTES.indexOf(flute))
    // 档案里存的楞型已不在选项里（如下线的「三层 B 瓦」）：原样保留，
    // 用户主动改选择器之前不要把它悄悄改成别的楞型
    const fluteRaw = flute && C.FLUTES.indexOf(flute) < 0 ? flute : ''
    const boxType = obj.boxType || C.BOX_TYPES[0]
    const boxTypeIndex = Math.max(0, C.BOX_TYPES.indexOf(boxType))
    const steps = C.normalizeSteps((obj.steps && obj.steps.length) ? obj.steps : C.defaultSteps(obj.craft || '草箱'))
    const craftName = C.CRAFTS[craftIndex] || '草箱'
    const history = obj.id ? app.getPriceHistory(obj.id) : []
    // 已有系列（去重、按拼音序），供下拉选择；手输新值也能用
    const seriesMap = {}
    app.getProducts().forEach(x => { if (x && x.series) seriesMap[x.series] = 1 })
    const seriesOptions = Object.keys(seriesMap).sort((a, b) => String(a).localeCompare(String(b), 'zh'))

    this.setData({
      id: obj.id || '',
      name: obj.name || '',
      seriesOptions,
      series: obj.series || '',
      craftIndex,
      craft: craftName,
      history,
      paperColorIndex: Math.max(0, C.PAPER_COLORS.indexOf(obj.paperColor || '黄面')),
      boxTypeIndex,
      manualBoard: C.MANUAL_BOARD_TYPES.indexOf(boxType) >= 0,
      boards: C.arr(obj.boards).map(b => ({
        L: String(b.L || ''), W: String(b.W || ''), qty: String(b.qty || '1'),
        crease: b.crease || '', creaseValue: b.creaseValue || '',
        creaseIndex: Math.max(0, C.CREASES.indexOf(b.crease || '不填'))
      })),
      // 纸板命名：多张纸板时主纸板=大板、第2张=小板、第3张起=附加纸板A/B…
      boardNames: C.boardNames(1 + (obj.boards || []).length).slice(1),
      fluteIndex,
      fluteRaw,
      sizeL: obj.sizeL ? String(obj.sizeL) : '',
      sizeW: obj.sizeW ? String(obj.sizeW) : '',
      sizeH: obj.sizeH ? String(obj.sizeH) : '',
      tang: obj.tang != null ? Number(obj.tang) : C.defaultTang(boxType),
      boardL: obj.boardL ? String(obj.boardL) : '',
      boardW: obj.boardW ? String(obj.boardW) : '',
      boardManual: false,
    formulaText: '',
      // 连体箱的片数由工艺定：草箱 1大1小（一片）、彩箱 2大1小（两片）；
      // 其他手填纸板箱型（梯形/异型）按进纸宽度算（草箱 2450 / 彩箱 1600）
      twoPiece: obj.boxType === '连体'
        ? obj.craft === '彩箱'
        : (C.MANUAL_BOARD_TYPES.indexOf(obj.boxType || '') > -1
          ? (Number(obj.boardL) || 0) > C.feedLimit(obj.craft || '草箱')
          : !!obj.twoPiece),
      pads: (obj.pads && obj.pads.length ? obj.pads : (obj.padType ? [{ type: obj.padType, L: obj.padL, W: obj.padW, qty: obj.padQty }] : [])).map(x => ({
        typeIndex: Math.max(0, C.PAD_TYPES.indexOf(x.type)),
        L: x.L ? String(x.L) : '',
        W: x.W ? String(x.W) : '',
        qty: x.qty || 0
      })),
      stockItem: !!obj.stockItem,
      stockAlertQty: Number(obj.stockAlertQty) || 0,
      outsource: obj.outsource || { mode: '', supplier: '' },
      outsourceEnabled: !!(obj.outsource && obj.outsource.mode),
      outsourceMode: (obj.outsource && obj.outsource.mode) || '',
      price: obj.price ? String(obj.price) : '',
      note: obj.note || '',
      selectedCustomers: C.arr(obj.customers).slice(),
      steps,
      creaseIndex: Math.max(0, C.CREASES.indexOf(obj.crease || '不填')),
      creaseValue: obj.creaseValue || '',
      customer: obj.customer || '',
      quantity: obj.quantity ? String(obj.quantity) : ''
    }, () => {
      this.refreshAll()
      this.recomputeBoard()
      this.refreshBoardLimit()
    })
  },

  refreshAll() {
    const steps = this.data.steps
    const selectedCustomers = this.data.selectedCustomers

    this.setData({
      stepOptions: C.STEPS
        .filter(n => n !== '代印刷' && n !== '代工')
        .map(name => ({ name, checked: steps.indexOf(name) > -1 })),
      customerOptions: this.data.customers.map(c => ({
        name: c.name,
        checked: selectedCustomers.indexOf(c.name) > -1
      }))
    })
  },

  // ---------- 基本 ----------
  onField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  onId(e) { this.setData({ id: e.detail.value }) },
  onName(e) { this.setData({ name: e.detail.value }) },
  onPrice(e) { this.setData({ price: e.detail.value }) },
  syncOutsourceOptions() {
    const isColor = this.data.craft === '彩箱'
    const enabled = !!this.data.outsourceEnabled
    const mode = enabled
      ? (isColor ? '成品箱' : (this.data.outsourceMode === '成品箱' ? '成品箱' : '代印'))
      : ''
    const outModes = isColor ? ['成品箱'] : ['代印', '成品箱']
    const outModeIndex = mode === '成品箱' ? 1 : 0
    const suppliers = app.getSuppliers().filter(s =>
      (s.types || []).indexOf(mode === '代印' ? '代印' : '成品箱') > -1)
    const names = ['暂不选择'].concat(suppliers.map(s => s.name))
    const sup = (this.data.outsource && this.data.outsource.supplier) || ''
    let si = names.indexOf(sup)
    if (si < 0) si = 0
    const keep = mode ? (sup && names.indexOf(sup) < 0 ? sup : (names[si] === '暂不选择' ? '' : names[si])) : ''
    this.setData({
      outModes,
      outModeIndex,
      outsourceMode: mode,
      supplierNames: mode ? names : [],
      supplierIndex: si,
      outsource: { mode, supplier: keep }
    })
  },

  onOutsourceEnabled(e) {
    const on = !!e.detail.value
    const isColor = this.data.craft === '彩箱'
    const mode = on ? (isColor ? '成品箱' : (this.data.outsourceMode || '代印')) : ''
    this.setData({
      outsourceEnabled: on,
      outsourceMode: mode,
      outsource: { mode, supplier: on ? (this.data.outsource.supplier || '') : '' }
    }, () => { this.syncOutsourceOptions(); this.applyAutoSteps(); this.refreshAll() })
  },

  onOutsourceMode(e) {
    const mode = this.data.outModes[Number(e.detail.value)] || ''
    this.setData({ outsourceMode: mode }, () => { this.syncOutsourceOptions(); this.applyAutoSteps(); this.refreshAll() })
  },

  onOutsourceSupplier(e) {
    const si = Number(e.detail.value)
    const raw = this.data.supplierNames[si] || ''
    const supplier = raw === '暂不选择' ? '' : raw
    this.setData({ supplierIndex: si, outsource: { mode: this.data.outsourceMode, supplier } })
  },

  applyAutoSteps() {
    const steps = C.buildSteps({
      craft: this.data.craft || (this.data.crafts || [])[this.data.craftIndex],
      boxType: (this.data.boxTypes || [])[this.data.boxTypeIndex] || '',
      outsource: this.data.outsource || {},
    })
    this.setData({ steps }, () => this.refreshAll())
  },

  // 勾选「常备款」：预警数量默认 300（可点右侧数字框手动改）
  onStockItem(e) {
    if (!e.detail.value) {
      this.setData({ stockItem: false, stockAlertQty: 0 })
      return
    }
    this.setData({
      stockItem: true,
      stockAlertQty: this.data.stockAlertQty || C.STOCK_ALERT_THRESHOLD
    })
  },

  // 点「预警数量」手动录入（该产品库存 ≤ 这个数就触发预警）
  editStockAlertQty() {
    wx.showModal({
      title: '常备预警数量',
      editable: true,
      content: String(this.data.stockAlertQty || C.STOCK_ALERT_THRESHOLD),
      placeholderText: '库存小于等于这个数时预警，例如 ' + C.STOCK_ALERT_THRESHOLD,
      success: res => {
        if (!res.confirm) return
        const n = parseInt(res.content, 10)
        if (!n || n <= 0) {
          wx.showToast({ title: '请输入大于 0 的数量', icon: 'none' })
          return
        }
        this.setData({ stockAlertQty: n })
      }
    })
  },

  addPad() {
    this.setData({ pads: this.data.pads.concat([{ typeIndex: 0, L: '', W: '', qty: 0 }]) })
  },
  removePad(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const pads = this.data.pads.slice()
    pads.splice(idx, 1)
    this.setData({ pads })
  },
  onPadField(e) {
    const { index, field } = e.currentTarget.dataset
    const pads = this.data.pads.slice()
    pads[Number(index)][field] = e.detail.value
    this.setData({ pads })
  },
  onPadType(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const pads = this.data.pads.slice()
    pads[idx].typeIndex = Number(e.detail.value)
    this.setData({ pads })
  },
  addPadQty(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const pads = this.data.pads.slice()
    pads[idx].qty = Math.max(0, (Number(pads[idx].qty) || 0) + Number(e.currentTarget.dataset.n))
    this.setData({ pads })
  },
  onNote(e) { this.setData({ note: e.detail.value }) },

  // 系列：手输即新建，点小三角从已有系列里挑
  onSeries(e) { this.setData({ series: e.detail.value }) },
  toggleSeries() { this.setData({ seriesOpen: !this.data.seriesOpen }) },
  pickSeries(e) {
    this.setData({ series: e.currentTarget.dataset.value || '', seriesOpen: false })
  },

  onCraft(e) {
    // craftIndex 必须一起更新：选择框显示（crafts[craftIndex]）和保存（C.CRAFTS[craftIndex]）都读它
    const craftIndex = Number(e.detail.value)
    const craft = this.data.crafts[craftIndex]
    const patch = { craftIndex, craft }
    // 连体箱片数跟着工艺走：草箱 1大1小（一片）、彩箱 2大1小（两片）
    if (this.data.boxTypes[this.data.boxTypeIndex] === '连体') patch.twoPiece = craft === '彩箱'
    this.setData(patch, () => { this.syncOutsourceOptions(); this.applyAutoSteps(); this.refreshAll(); this.refreshBoardLimit() })
  },

  onPaperColor(e) {
    this.setData({ paperColorIndex: Number(e.detail.value) })
  },

  onBoxType(e) {
    const boxTypeIndex = Number(e.detail.value)
    const boxType = C.BOX_TYPES[boxTypeIndex]
    const tang = C.defaultTang(boxType)
    // 梯形箱/连体/异型箱：纸板尺寸一律手填，纸箱尺寸栏隐藏
    const manualBoard = C.MANUAL_BOARD_TYPES.indexOf(boxType) >= 0
    // 小盒默认三层 A 瓦
    const dfltFlute = C.defaultFlute(boxType)
    const fluteIndex = dfltFlute ? Math.max(0, C.FLUTES.indexOf(dfltFlute)) : this.data.fluteIndex

    // 连体箱默认带一块小板：草箱 1大1小、彩箱 2大1小
    const isLianTi = boxType === '连体'
    const nextBoards = (isLianTi && C.arr(this.data.boards).length === 0)
      ? [{ L: '', W: '', qty: '1', crease: '', creaseIndex: 0 }]
      : this.data.boards

    this.setData({
      boxTypeIndex,
      manualBoard,
      fluteIndex,
      tang,
      boardManual: manualBoard,
      boards: nextBoards,
      // 连体箱片数由工艺定：草箱 1大1小（一片）、彩箱 2大1小（两片）
      twoPiece: isLianTi
        ? this.data.craft === '彩箱'
        : (manualBoard
          ? (Number(this.data.boardL) || 0) > C.feedLimit(this.data.craft)
          : this.data.twoPiece)
    }, () => {
      if (isLianTi) this.syncBoardNames(nextBoards)
      this.applyAutoSteps()
      if (!manualBoard) this.recomputeBoard()
      this.refreshBoardLimit()
    })
  },

  onFlute(e) {
    const fluteIndex = Number(e.detail.value)
    const flute = C.FLUTES[fluteIndex]
    this.setData({
      fluteIndex,
      fluteRaw: ''
    })
  },

  onSize(e) {
    const field = e.currentTarget.dataset.field
    const manual = this.data.manualBoard
    this.setData({ [field]: e.detail.value, boardManual: manual ? true : false }, () => { if (!manual) this.recomputeBoard() })
  },

  onTang(e) {
    this.setData({ tang: e.detail.value, boardManual: false }, () => this.recomputeBoard())
  },

  recomputeForce() {
    this.setData({ boardManual: false }, () => {
      this.recomputeBoard()
      wx.showToast({ title: '已按公式重算', icon: 'none' })
    })
  },

  // ===== 附加纸板（一款纸箱由多个不同规格的纸板做成）=====
  // 纸板命名：多张纸板时主纸板=大板、第2张=小板、第3张起=附加纸板A/B…
  // 这里只列附加纸板的名字（主纸板是「大板」，在上面的规格区显示）
  syncBoardNames(boards) {
    const list = boards || []
    // 附加纸板的名字从第 2 张算起，所以总张数 = 1(主) + 附加数
    const all = C.boardNames(1 + list.length)
    this.setData({ boardNames: all.slice(1) })
  },

  addBoard() {
    const boards = (this.data.boards || []).concat([{ L: '', W: '', qty: '1', crease: '', creaseIndex: 0 }])
    this.setData({ boards }, () => { this.syncBoardNames(boards); this.refreshBoardLimit() })
  },

  removeBoard(e) {
    const index = Number(e.currentTarget.dataset.index)
    const boards = C.arr(this.data.boards).filter((_, i) => i !== index)
    this.setData({ boards }, () => { this.syncBoardNames(boards); this.refreshBoardLimit() })
  },

  onBoardField(e) {
    const index = Number(e.currentTarget.dataset.index)
    const field = e.currentTarget.dataset.field
    const boards = C.arr(this.data.boards).slice()
    const row = Object.assign({}, boards[index] || {})
    row[field] = e.detail.value
    boards[index] = row
    this.setData({ boards }, () => this.refreshBoardLimit())
  },

  // 连体箱片数按工艺固定（草 1大1小 / 彩 2大1小），无法自动拆片：
  // 纸板长超过进纸上限（草箱 2450 / 彩箱 1600）时红字提示
  refreshBoardLimit() {
    const limit = C.feedLimit(this.data.craft)
    const over = []
    if ((Number(this.data.boardL) || 0) > limit) over.push('大板')
    C.arr(this.data.boards).forEach((b, i) => {
      if ((Number(b && b.L) || 0) > limit) over.push((this.data.boardNames || [])[i] || ('附加纸板' + (i + 1)))
    })
    this.setData({ boardLimit: limit, overBoardText: over.join('、') })
  },

  onBoard(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    this.setData({ [field]: value, boardManual: true }, () => {
      // 连体箱不参与几片成型判定（本身就是两片/三片）
      if (this.data.boxTypes[this.data.boxTypeIndex] === '连体') {
        this.refreshBoardLimit()
        return
      }
      const length = Number(this.data.boardL) || 0
      this.setData({ twoPiece: length > C.feedLimit(this.data.craft) }, () => this.refreshBoardLimit())
    })
  },

  // 主纸板压线
  onCrease(e) {
    const creaseIndex = Number(e.detail.value)
    this.setData({
      creaseIndex,
      crease: C.CREASES[creaseIndex] === '不填' ? '' : (C.CREASES[creaseIndex] || '')
    })
  },

  // 附加纸板压线
  onBoardCrease(e) {
    const index = Number(e.currentTarget.dataset.index)
    const creaseIndex = Number(e.detail.value)
    const boards = C.arr(this.data.boards).slice()
    const row = Object.assign({}, boards[index] || {})
    row.creaseIndex = creaseIndex
    row.crease = C.CREASES[creaseIndex] === '不填' ? '' : (C.CREASES[creaseIndex] || '')
    boards[index] = row
    this.setData({ boards }, () => this.refreshBoardLimit())
  },

  // 压线位置（如 170+650+235+220+405）
  onCreaseValue(e) {
    this.setData({ creaseValue: e.detail.value })
  },

  onBoardCreaseValue(e) {
    const index = Number(e.currentTarget.dataset.index)
    const boards = C.arr(this.data.boards).slice()
    const row = Object.assign({}, boards[index] || {})
    row.creaseValue = e.detail.value
    boards[index] = row
    this.setData({ boards })
  },

  recomputeBoard() {
    if (this.data.manualBoard) {
      this.setData({
        twoPiece: true,
        formulaText: '该箱型：纸板尺寸手动填写'
      })
      return
    }
    const { sizeL, sizeW, sizeH, tang } = this.data
    const r = C.calcBoard(sizeL, sizeW, sizeH, tang, this.data.craft)
    const L = Number(sizeL) || 0
    const W = Number(sizeW) || 0
    const H = Number(sizeH) || 0
    const T = Number(tang) || 0
    const one = (L + W) * 2 + T
    const two = L + W + T
    this.setData({
      boardL: r.length ? String(r.length) : '',
      boardW: r.width ? String(r.width) : '',
      twoPiece: r.twoPiece,
      formulaText: ''
    })
  },

  // ---------- 步骤 ----------
  toggleStep(e) {
    const name = e.currentTarget.dataset.name
    if (name === '代印刷' || name === '代工') return
    let steps = [...this.data.steps]
    const idx = steps.indexOf(name)

    if (idx > -1) {
      steps.splice(idx, 1)
    } else {
      steps.push(name)
      steps.sort((a, b) => C.STEPS.indexOf(a) - C.STEPS.indexOf(b))
    }

    this.setData({ steps }, () => {
      this.refreshAll()
    })
  },

  toggleCustomer(e) {
    const name = e.currentTarget.dataset.name
    const list = [...this.data.selectedCustomers]
    const idx = list.indexOf(name)
    if (idx > -1) list.splice(idx, 1)
    else list.push(name)
    this.setData({ selectedCustomers: list }, () => this.refreshAll())
  },

  goCustomers() {
    wx.navigateTo({ url: '/pages/customers/customers' })
  },

  // ---------- 物料 ----------
  // ---------- 组装 ----------
  buildProduct() {
    const d = this.data
    const craft = C.CRAFTS[d.craftIndex]
    const flute = d.fluteRaw || C.FLUTES[d.fluteIndex]

    return {
      id: (d.id || '').trim(),
      name: (d.name || '').trim(),
      craft,
      paperColor: craft === '草箱' ? C.PAPER_COLORS[d.paperColorIndex] : '',
      boxType: C.BOX_TYPES[d.boxTypeIndex],
      flute,
      sizeL: parseInt(d.sizeL) || 0,
      sizeW: parseInt(d.sizeW) || 0,
      sizeH: parseInt(d.sizeH) || 0,
      tang: parseInt(d.tang) || 0,
      boardL: parseInt(d.boardL) || 0,
      boardW: parseInt(d.boardW) || 0,
      boardManual: !!d.boardManual,
      twoPiece: !!d.twoPiece,
      crease: C.CREASES[d.creaseIndex] === '不填' ? '' : (C.CREASES[d.creaseIndex] || ''),
      creaseValue: C.CREASES[d.creaseIndex] === '不填' ? '' : String(d.creaseValue || '').trim(),
      customers: d.selectedCustomers.slice(),
      series: (d.series || '').trim(),
      steps: C.normalizeSteps(d.steps || []),
      pads: d.pads.filter(x => x.qty > 0 || x.L || x.W).map(x => ({
        type: C.PAD_TYPES[x.typeIndex] || C.PAD_TYPES[0],
        L: parseInt(x.L) || 0,
        W: parseInt(x.W) || 0,
        qty: parseInt(x.qty) || 0
      })),
      stockItem: !!d.stockItem,
      boards: C.arr(d.boards).filter(b => b && (b.L || b.W)).map(b => ({
        L: Number(b.L) || 0,
        W: Number(b.W) || 0,
        qty: Number(b.qty) || 1,
        crease: b.crease || '',
        creaseValue: b.crease ? String(b.creaseValue || '').trim() : ''
      })),
      stockAlertQty: d.stockItem ? (Number(d.stockAlertQty) || 0) : 0,
      outsource: d.outsourceEnabled ? { mode: d.outsourceMode || (d.craft === '彩箱' ? '成品箱' : ''), supplier: (d.outsource && d.outsource.supplier) || '' } : { mode: '', supplier: '' },
      price: Number(d.price) || 0,
      note: (d.note || '').trim(),
      // 必须毫秒数：多设备合并按 updatedAt 定胜负，app.now() 是日期字符串，
      // Number('YYYY-MM-DD') 是 NaN，比较时恒为 0，等于没有
      updatedAt: Date.now()
    }
  },

  save() {
    // 保存前按公式兜底重算，避免刚输入完就点保存时纸板尺寸还是旧值
    if (!this.data.manualBoard && !this.data.boardManual) {
      const r = C.calcBoard(this.data.sizeL, this.data.sizeW, this.data.sizeH, this.data.tang, this.data.craft)
      this.setData({
        boardL: r.length ? String(r.length) : '',
        boardW: r.width ? String(r.width) : '',
        twoPiece: r.twoPiece
      })
    }
    const p = this.buildProduct()
    if (this.data.manualBoard) {
      const d = this.data
      if (!d.boardL || !d.boardW) {
        wx.showToast({ title: '请手动填写纸板尺寸', icon: 'none' }); return
      }
    }
    if (!p.id) { wx.showToast({ title: '请输入产品编号', icon: 'none' }); return }
    if (!p.name) { wx.showToast({ title: '请输入产品名称', icon: 'none' }); return }
    if (p.steps.length === 0) { wx.showToast({ title: '请选择工序', icon: 'none' }); return }

    const all = app.getProducts()
    // 排除「自己」要用加载时的原始编号，不能用当前输入框的值：
    // 用户把编号输入框改成别人的编号时，用 data.id 会「自己排除自己」，
    // 检查失效后静默覆盖已有产品
    const originId = this._originId != null ? this._originId : this.data.id
    if (all.find(x => x.id === p.id && x.id !== originId)) {
      wx.showToast({ title: '编号已存在', icon: 'none' }); return
    }
    const dupName = all.find(x => x.name === p.name && x.id !== originId)
    if (dupName) { wx.showToast({ title: '名称已存在（' + dupName.id + '）', icon: 'none' }); return }

    app.upsertProducts([p])
    // 允许改编号（用户 2026-10-25 决定）：改编号后必须删掉旧编号的产品，
    // 否则 upsert 按新 id 新增、旧 id 产品原地残留，变成列表里删不掉的「幽灵产品」
    if (this.data.isEdit && originId && p.id !== originId) {
      app.removeProduct(originId)
      // 编号改了，订单里指向旧编号的明细一起改过来，否则销量统计和档案同步会断
      app.remapProductId(originId, p.id)
    }
    // 产品档案改了，未完成的订单里同款产品同步更新（数量/单价/工序进度不动）
    // 放在改号之后：先改引用，再按新编号同步字段
    app.syncProductToOpenOrders(p)
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 500)
  },

  // ---------- 打样 ----------
  saveDraft() {
    const d = this.data
    const p = this.buildProduct()
    if (!p.name) { wx.showToast({ title: '请先填样品名称', icon: 'none' }); return }

    const draft = Object.assign({}, p, {
      id: d.draftId || ('SP' + Date.now()),
      draftId: d.draftId || ('SP' + Date.now()),
      name: p.name,
      customer: (d.customer || '').trim(),
      quantity: parseInt(d.quantity) || 0,
      status: 'draft',
      updatedAt: Date.now(),
      createdAt: d.draftId ? (app.getDraft(d.draftId) || {}).createdAt || app.now() : app.now()
    })
    app.upsertDraft(draft)
    this.setData({ draftId: draft.id })
    wx.showToast({ title: '草稿已保存', icon: 'success' })
  },

  convert() {
    const p = this.buildProduct()
    if (!p.id) { wx.showToast({ title: '请填写产品编号', icon: 'none' }); return }
    if (!p.name) { wx.showToast({ title: '请填写产品名称', icon: 'none' }); return }
    if (p.steps.length === 0) { wx.showToast({ title: '请选择工序', icon: 'none' }); return }

    const all = app.getProducts()
    if (all.find(x => x.id === p.id)) {
      wx.showToast({ title: '编号已存在', icon: 'none' }); return
    }

    const product = this.buildProduct()
    app.upsertProducts([product])

    if (this.data.draftId) {
      const draft = app.getDraft(this.data.draftId) || {}
      app.upsertDraft(Object.assign({}, draft, {
        status: 'converted',
        productId: product.id,
        updatedAt: Date.now()
      }))
    }

    wx.showModal({
      title: '已转为产品档案',
      content: '产品「' + product.id + ' ' + product.name + '」已归档，可以直接下单了。',
      showCancel: false,
      success: () => wx.navigateBack()
    })
  },

  remove() {
    const d = this.data
    const isDraft = d.mode === 'sample' && d.draftId
    wx.showModal({
      title: isDraft ? '删除草稿' : '删除产品',
      content: isDraft ? '确定删除这份打样草稿吗？' : ('确定删除 ' + d.id + ' 吗？已下的订单不受影响。'),
      confirmColor: '#e94560',
      success: res => {
        if (!res.confirm) return
        if (isDraft) app.removeDraft(d.draftId)
        else {
          app.recordUndo('products', app.getProducts(), '删除产品')
          app.removeProduct(d.id)
        }
        wx.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 500)
      }
    })
  }
})
