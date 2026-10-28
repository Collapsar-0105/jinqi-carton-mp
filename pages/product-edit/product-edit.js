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
    isTrapezoid: false,
    manualBoard: false,
    boards: [],

    sizeL: '',
    sizeW: '',
    sizeH: '',

    // 梯形箱五尺寸
    sizeTL: '',
    sizeTW: '',
    sizeH2: '',
    sizeBL: '',
    sizeBW: '',

    flutes: C.FLUTES,
    fluteIndex: 0,


    history: [],
    addrOptions: [],
    addrIndex: 0,

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

    materialTypes: C.MATERIAL_TYPES,
    materials: [],

    padTypes: C.PAD_TYPES,
    pads: [],

    stockItem: false,

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

    this.setData({
      id: obj.id || '',
      name: obj.name || '',
      craftIndex,
      craft: craftName,
      history,
      paperColorIndex: Math.max(0, C.PAPER_COLORS.indexOf(obj.paperColor || '黄面')),
      boxTypeIndex,
      isTrapezoid: boxType === '梯形箱',
      manualBoard: C.MANUAL_BOARD_TYPES.indexOf(boxType) >= 0,
      boards: (obj.boards || []).map(b => ({ L: String(b.L || ''), W: String(b.W || ''), qty: String(b.qty || '1') })),
      sizeTL: obj.sizeTL ? String(obj.sizeTL) : '',
      sizeTW: obj.sizeTW ? String(obj.sizeTW) : '',
      sizeH2: obj.sizeH2 ? String(obj.sizeH2) : '',
      sizeBL: obj.sizeBL ? String(obj.sizeBL) : '',
      sizeBW: obj.sizeBW ? String(obj.sizeBW) : '',
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
      twoPiece: !!obj.twoPiece,
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
      selectedCustomers: (obj.customers || []).slice(),
      steps,
      materials: (obj.materials || []).map(m => ({
        name: m.name,
        typeIndex: Math.max(0, C.MATERIAL_TYPES.indexOf(m.type)),
        price: m.price ? String(m.price) : ''
      })),
      customer: obj.customer || '',
      quantity: obj.quantity ? String(obj.quantity) : '',
      _presetAddr: obj.addrPreset || null,
    }, () => {
      this.refreshAll()
      this.recomputeBoard()
      this.applyPresetAddr()
    })
  },

  // 载入产品时，把预设地址对上选项下标
  applyPresetAddr() {
    const preset = this.data._presetAddr
    if (!preset || !preset.address) return
    const list = this.data.addrOptions || []
    const i = list.findIndex(a => a.address === preset.address && (!preset.customer || a.customer === preset.customer))
    if (i > -1) this.setData({ addrIndex: i })
  },

  refreshAll() {
    const steps = this.data.steps
    const selectedCustomers = this.data.selectedCustomers

    // 默认收货地址：只列该产品绑定客户的地址
    const addrOptions = []
    selectedCustomers.forEach(cn => {
      app.customerAddresses(cn).forEach(a => {
        addrOptions.push({
          customer: cn,
          address: a.address,
          contact: a.contact || '',
          phone: a.phone || '',
          label: cn + ' · ' + a.address
        })
      })
    })
    let addrIndex = Number(this.data.addrIndex) || 0
    if (addrIndex >= addrOptions.length) addrIndex = 0

    this.setData({
      stepOptions: C.STEPS
        .filter(n => n !== '代印刷' && n !== '代工')
        .map(name => ({ name, checked: steps.indexOf(name) > -1 })),
      customerOptions: this.data.customers.map(c => ({
        name: c.name,
        checked: selectedCustomers.indexOf(c.name) > -1
      })),
      addrOptions,
      addrIndex
    })
  },

  onAddrPreset(e) {
    this.setData({ addrIndex: Number(e.detail.value) })
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

  onCraft(e) {
    const craft = this.data.crafts[Number(e.detail.value)]
    this.setData({ craft }, () => { this.syncOutsourceOptions(); this.applyAutoSteps(); this.refreshAll() })
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

    this.setData({
      boxTypeIndex,
      isTrapezoid: boxType === '梯形箱',
      manualBoard,
      fluteIndex,
      tang,
      boardManual: manualBoard,
      twoPiece: manualBoard ? true : this.data.twoPiece
    }, () => {
      this.applyAutoSteps()
      if (!manualBoard) this.recomputeBoard()
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
  addBoard() {
    const boards = (this.data.boards || []).concat([{ L: '', W: '', qty: '1' }])
    this.setData({ boards })
  },

  removeBoard(e) {
    const index = Number(e.currentTarget.dataset.index)
    const boards = (this.data.boards || []).filter((_, i) => i !== index)
    this.setData({ boards })
  },

  onBoardField(e) {
    const index = Number(e.currentTarget.dataset.index)
    const field = e.currentTarget.dataset.field
    const boards = (this.data.boards || []).slice()
    const row = Object.assign({}, boards[index] || {})
    row[field] = e.detail.value
    boards[index] = row
    this.setData({ boards })
  },

  onBoard(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    this.setData({ [field]: value, boardManual: true }, () => {
      const length = Number(this.data.boardL) || 0
      this.setData({ twoPiece: length > C.feedLimit(this.data.craft) })
    })
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
  addMaterial() {
    const materials = [...this.data.materials]
    materials.push({ name: '', typeIndex: 0, price: '' })
    this.setData({ materials })
  },

  removeMaterial(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const materials = [...this.data.materials]
    materials.splice(idx, 1)
    this.setData({ materials })
  },

  onMaterialName(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const materials = [...this.data.materials]
    materials[idx].name = e.detail.value
    this.setData({ materials })
  },

  onMaterialType(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const materials = [...this.data.materials]
    materials[idx].typeIndex = Number(e.detail.value)
    this.setData({ materials })
  },

  onMaterialPrice(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const materials = [...this.data.materials]
    materials[idx].price = e.detail.value
    this.setData({ materials })
  },

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
      sizeTL: parseInt(d.sizeTL) || 0,
      sizeTW: parseInt(d.sizeTW) || 0,
      sizeH2: parseInt(d.sizeH2) || 0,
      sizeBL: parseInt(d.sizeBL) || 0,
      sizeBW: parseInt(d.sizeBW) || 0,
      tang: parseInt(d.tang) || 0,
      boardL: parseInt(d.boardL) || 0,
      boardW: parseInt(d.boardW) || 0,
      boardManual: !!d.boardManual,
      twoPiece: !!d.twoPiece,
      customers: d.selectedCustomers.slice(),
      // 预设收货地址（只记客户+地址，订单里能对上就用）
      addrPreset: (function() {
        const a = (d.addrOptions || [])[Number(d.addrIndex) || 0]
        return a ? { customer: a.customer, address: a.address, contact: a.contact || '', phone: a.phone || '' } : null
      })(),
      steps: C.normalizeSteps(d.steps || []),
      materials: d.materials
        .filter(m => (m.name || '').trim())
        .map(m => ({
          name: m.name.trim(),
          type: C.MATERIAL_TYPES[m.typeIndex],
          price: Number(m.price) || 0
        })),
      pads: d.pads.filter(x => x.qty > 0 || x.L || x.W).map(x => ({
        type: C.PAD_TYPES[x.typeIndex] || C.PAD_TYPES[0],
        L: parseInt(x.L) || 0,
        W: parseInt(x.W) || 0,
        qty: parseInt(x.qty) || 0
      })),
      stockItem: !!d.stockItem,
      boards: (d.boards || []).filter(b => b && (b.L || b.W)).map(b => ({
        L: Number(b.L) || 0,
        W: Number(b.W) || 0,
        qty: Number(b.qty) || 1
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

    app.upsertProducts([this.buildProduct()])
    // 允许改编号（用户 2026-10-25 决定）：改编号后必须删掉旧编号的产品，
    // 否则 upsert 按新 id 新增、旧 id 产品原地残留，变成列表里删不掉的「幽灵产品」
    if (this.data.isEdit && originId && p.id !== originId) {
      app.removeProduct(originId)
    }
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
