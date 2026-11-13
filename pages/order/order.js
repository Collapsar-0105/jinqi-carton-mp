const app = getApp()
const C = require('../../utils/constants.js')

Page({
  data: {
    fontClass: '',
    kbHeight: 0,
    footerBottom: 0,
    isIOS: false,
    customers: [],
    customerNames: [],
    customerIndex: 0,          // 0 = 其他
    customer: '其他',
    orderNo: '',
    needOrderNo: false,

    today: '',

    items: [],

    materialTypes: C.MATERIAL_TYPES,
    factoryModes: ['本厂生产', '外协代工']
  },

  onUnload() {
    if (this.kbHandler && wx.offKeyboardHeightChange) wx.offKeyboardHeightChange(this.kbHandler)
  },

  onLoad() {
    // 这是填单页，表单内容还没保存；云同步落地时不要重建本页（见 app.reloadCurrentPage）
    this.noAutoReload = true
    const sys = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    this.setData({ isIOS: sys.platform === 'ios' })
    this.kbHandler = res => this.setData({
      kbHeight: res.height,
      footerBottom: this.data.isIOS ? res.height : 0
    })
    if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(this.kbHandler)

    this.setData({ today: app.today() })
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass() })
    const customers = app.getCustomers()
    this.setData({
      customers,
      customerNames: ['其他'].concat(customers.map(c => c.name)),
      today: app.today()
    })

    const picked = wx.getStorageSync('pending_product_id')
    if (picked) {
      wx.removeStorageSync('pending_product_id')
      this.addItem(picked)
    }
  },

  onCustomer(e) {
    const idx = Number(e.detail.value)
    this.setData({
      customerIndex: idx,
      customer: this.data.customerNames[idx] || '其他',
      needOrderNo: (this.data.customerNames[idx] || '') === '许昌恒尔'
    }, () => {
      // 换客户后已选产品可能不属于该客户，提示但不强制清空
      if (idx > 0 && this.data.items.length) {
        const names = this.data.items.map(i => i.productName)
        const bad = this.data.items.filter(i => {
          const p = app.getProduct(i.productId)
          return p && (p.customers || []).length && (p.customers || []).indexOf(this.data.customer) === -1
        })
        if (bad.length) {
          wx.showToast({ title: '有 ' + bad.length + ' 款产品不属于该客户', icon: 'none' })
        }
      }
    })
  },

  // ---------- 产品 ----------
  chooseProduct() {
    wx.setStorageSync('pending_customer_filter', this.data.customerIndex > 0 ? this.data.customer : '')
    wx.navigateTo({ url: '/pages/product-select/product-select' })
  },

  addItem(productId) {
    const p = app.getProduct(productId)
    if (!p) { wx.showToast({ title: '产品不存在', icon: 'none' }); return }

    const last = app.getLastPrice(p.id)
    const history = app.getPriceHistory(p.id)

    // 纸板尺寸按公式重算，避免产品档案里的旧值不准
    const tang = p.tang != null ? Number(p.tang) : C.defaultTang(p.boxType || '')
    // 手填纸板的箱型（梯形箱/连体/异型箱）：纸板尺寸直接用档案里的值，不按公式推。
    const manualBoard = C.MANUAL_BOARD_TYPES.indexOf(p.boxType || '') >= 0
    // 连体箱本身就是两片/三片成型，不参与「一片/两片」判定，数量按一片算；
    // 梯形/异型按进纸宽度算（草箱 2450 / 彩箱 1600）
    const board = manualBoard
      ? {
        length: p.boardL || 0,
        width: p.boardW || 0,
        twoPiece: p.boxType === '连体' ? p.craft === '彩箱' : (Number(p.boardL) || 0) > C.feedLimit(p.craft)
      }
      : C.calcBoard(p.sizeL, p.sizeW, p.sizeH, tang, p.craft)

    const pads = (p.pads && p.pads.length)
      ? p.pads.map(x => ({ type: x.type, L: x.L, W: x.W, qty: x.qty }))
      : (p.padType ? [{ type: p.padType, L: p.padL || 0, W: p.padW || 0, qty: p.padQty || 0 }] : [])

    const steps = C.normalizeSteps(p.steps && p.steps.length ? p.steps : C.defaultSteps(p.craft || '草箱'))

    // 一款由多种规格纸板做成时，「纸板到货」按纸板种类拆成多道，各记各的数量
    const boards = C.arr(p.boards).filter(b => b && (b.L || b.W)).map(b => ({
      L: Number(b.L) || 0,
      W: Number(b.W) || 0,
      qty: Number(b.qty) || 1
    }))
    const stepList = []
    steps.forEach(name => {
      if (name !== '纸板到货') { stepList.push({ name, status: 'pending', doneQty: 0 }); return }
      // 主纸板一道：单纸板时沿用老名字，多纸板时按「大板/小板/附加纸板A」区分
      const specs = C.boardSpecs({
        boardL: board.length, boardW: board.width, twoPiece: board.twoPiece, boards: boards
      })
      specs.forEach((sp, i) => {
        stepList.push({
          name: '纸板到货',
          boardKey: sp.key,
          boardName: sp.name || '',
          status: 'pending',
          doneQty: 0
        })
      })
    })

    const item = {
      key: 'k' + Date.now() + Math.floor(Math.random() * 1000),
      productId: p.id,
      productName: p.name,
      craft: p.craft || '草箱',
      paperColor: p.paperColor || '',
      boxType: p.boxType || '',
      flute: p.flute || '',
      sizeL: p.sizeL || 0,
      sizeW: p.sizeW || 0,
      sizeH: p.sizeH || 0,
      tang,
      boardL: board.length,
      boardW: board.width,
      twoPiece: board.twoPiece,
      crease: p.crease || '',
      creaseValue: p.creaseValue || '',
      // 附加纸板（一款由多种不同规格纸板做成时，选产品就要一起带过来）
      boards: C.arr(p.boards).filter(b => b && (b.L || b.W)).map(b => ({
        L: Number(b.L) || 0,
        W: Number(b.W) || 0,
        qty: Number(b.qty) || 1,
        crease: b.crease || '',
        creaseValue: b.creaseValue || ''
      })),
      po: '',
      pads,
      quantity: '',
      price: last ? String(last.price) : (p.price ? String(p.price) : ''),
      priceOptions: history,
      priceHint: last ? '返单 · 上次 ¥' + last.price : '新单 · 请核价',
      factoryModeIndex: 0,
      factoryName: '',
      factoryPrice: '',
      factories: app.getServiceSuppliers().map(s => s.name),
      purchases: [],
      steps: stepList,
      // 该产品当前还剩多少可送（已入库未送完 + 超量多出来的），选品时算一次，
      // 填单过程中库存不会变，不用反复重算
      stockQty: app.productStockQty(p.id)
    }

    // 纸板命名：多张纸板时主纸板=大板、第2张=小板、第3张起=附加纸板A/B…
    const bNames = C.boardNames(1 + (item.boards || []).length)
    item.boardName = bNames[0] || ''
    item.boardNames = bNames.slice(1)

    // 收货地址已移除（1.9.101）：下单不再记地址
    this.setData({ items: this.data.items.concat([item]) })

    if (p.stockItem && app.hasStockAlert(p.id)) {
      wx.showModal({
        title: '常备预警',
        content: '「' + p.name + '」有常备预警，本单可取消预警，是否取消？',
        confirmText: '取消预警',
        success: res => {
          if (!res.confirm) return
          const a = app.getStockAlerts().find(x => x.productId === p.id)
          if (a) { app.removeStockAlert(a.id); wx.showToast({ title: '预警已取消', icon: 'none' }) }
        }
      })
    }
  },

  onPO(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const items = [...this.data.items]
    items[idx].po = e.detail.value
    this.setData({ items })
  },

  removeItem(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const items = [...this.data.items]
    items.splice(idx, 1)
    this.setData({ items })
  },

  onItemField(e) {
    const { index, field } = e.currentTarget.dataset
    const items = [...this.data.items]
    items[index][field] = e.detail.value
    this.setData({ items })
  },

  onItemFactoryMode(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const items = [...this.data.items]
    items[idx].factoryModeIndex = Number(e.detail.value)
    this.setData({ items })
  },

  onItemFactory(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const items = [...this.data.items]
    const i = Number(e.detail.value)
    items[idx].factoryName = items[idx].factories[i] || ''
    this.setData({ items })
  },

  onPurchaseField(e) {
    const { item, index, field } = e.currentTarget.dataset
    const items = [...this.data.items]
    items[item].purchases[index][field] = e.detail.value
    this.setData({ items })
  },

  // 采购物料改成下单时手动加（已和产品档案解绑）
  addPurchase(e) {
    const idx = Number(e.currentTarget.dataset.item)
    const items = [...this.data.items]
    const names = app.getSuppliers().map(s => s.name)
    items[idx].purchases = (items[idx].purchases || []).concat([{
      typeIndex: 0,
      type: C.MATERIAL_TYPES[0],
      name: '',
      supplierNames: names,
      supplierIndex: 0,
      supplier: '',
      price: '',
      quantity: ''
    }])
    this.setData({ items })
  },

  removePurchase(e) {
    const { item, index } = e.currentTarget.dataset
    const items = [...this.data.items]
    items[Number(item)].purchases.splice(Number(index), 1)
    this.setData({ items })
  },

  onPurchaseType(e) {
    const { item, index } = e.currentTarget.dataset
    const items = [...this.data.items]
    const row = items[Number(item)].purchases[Number(index)]
    const typeIndex = Number(e.detail.value)
    row.typeIndex = typeIndex
    row.type = C.MATERIAL_TYPES[typeIndex]
    this.setData({ items })
  },

  onPurchaseSupplier(e) {
    const { item, index } = e.currentTarget.dataset
    const items = [...this.data.items]
    const row = items[Number(item)].purchases[Number(index)]
    const si = Number(e.detail.value)
    row.supplierIndex = si
    row.supplier = (row.supplierNames || [])[si] || ''
    this.setData({ items })
  },

  copyOrderInfo(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const it = this.data.items[idx]
    if (!it) return
    const d = this.data

    // 手填纸板的箱型（梯形箱/连体/异型箱）没有纸箱尺寸，别复制出 0×0×0mm
    const sizeText = it.sizeL ? it.sizeL + '×' + it.sizeW + '×' + it.sizeH + 'mm' : ''

    // 固定行：没有内容的也留空行，方便复制后手填；PO 例外——没填说明这单没 PO，不输出
    const lines = [
      '产品：' + it.productId + ' ' + it.productName,
      '箱型：' + (it.boxType || ''),
      '楞型：' + (it.flute || '')
    ]
    if (it.po) lines.push('PO：' + it.po)
    lines.push(
      '面纸颜色：' + (it.paperColor || ''),
      '尺寸：' + sizeText
    )
    // 纸板：多纸板时每种各自标出要备多少张
    C.boardLines(it, C.boardSpecs(it).length > 1).forEach(l => lines.push(l))
    lines.push(
      '数量：' + ((parseInt(it.quantity) || 0) + 5),
      '收货：'
    )

    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '订单信息已复制', icon: 'success' })
    })
  },

  goSuppliers() {
    wx.navigateTo({ url: '/pages/suppliers/suppliers' })
  },

  // 选历史价
  onPricePick(e) {
    const { index, price } = e.currentTarget.dataset
    const items = [...this.data.items]
    items[Number(index)].price = String(price)
    this.setData({ items })
  },

  // 清空可选字段
  clearCustomer() {
    this.setData({ customerIndex: 0, customer: '其他' })
  },

  clearFactory(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const items = [...this.data.items]
    items[idx].factoryName = ''
    this.setData({ items })
  },

  // ---------- 提交 ----------
  onOrderNo(e) { this.setData({ orderNo: e.detail.value }) },

  submit() {
    const d = this.data
    if (!d.items.length) { wx.showToast({ title: '请添加产品', icon: 'none' }); return }

    for (let i = 0; i < d.items.length; i++) {
      const it = d.items[i]
      if (!it.quantity || parseInt(it.quantity) <= 0) {
        wx.showToast({ title: '第 ' + (i + 1) + ' 款数量未填', icon: 'none' }); return
      }
      if (it.price === '' || Number(it.price) < 0) {
        wx.showToast({ title: '第 ' + (i + 1) + ' 款单价未填', icon: 'none' }); return
      }
      if (it.factoryModeIndex === 1 && !it.factoryName) {
        wx.showToast({ title: '第 ' + (i + 1) + ' 款未选代工厂', icon: 'none' }); return
      }
    }

    const order = {
      customer: d.customer || '其他',
      orderNo: (d.orderNo || '').trim(),
      status: 'active',
      items: d.items.map(it => ({
        productId: it.productId,
        productName: it.productName,
        po: (it.po || '').trim(),
        craft: it.craft,
        paperColor: it.paperColor,
        boxType: it.boxType,
        flute: it.flute,
        sizeL: it.sizeL,
        sizeW: it.sizeW,
        sizeH: it.sizeH,
        tang: it.tang,
      boardL: it.boardL,
      boardW: it.boardW,
      twoPiece: it.twoPiece,
      crease: it.crease || '',
      creaseValue: it.creaseValue || '',
      // 附加纸板：从别处复制/带入的明细也要带上
      boards: C.arr(it.boards).filter(b => b && (b.L || b.W)).map(b => ({
        L: Number(b.L) || 0,
        W: Number(b.W) || 0,
        qty: Number(b.qty) || 1,
        crease: b.crease || '',
        creaseValue: b.creaseValue || ''
      })),
        pads: it.pads || [],
        quantity: parseInt(it.quantity),
        splitQty: 0,
        price: Number(it.price),
        steps: it.steps,
        purchases: it.purchases.filter(p => (p.name || '').trim()).map(p => ({
          type: p.type,
          name: p.name,
          supplier: p.supplier,
          price: p.price,
          quantity: p.quantity,
          status: 'pending'
        })),
        factoryMode: d.factoryModes[it.factoryModeIndex],
        factoryName: it.factoryModeIndex === 1 ? it.factoryName : '',
        factoryPrice: it.factoryModeIndex === 1 ? (Number(it.factoryPrice) || 0) : 0,
        stocked: false,
        deliveredQty: 0
      })),
      shipments: [],
      createdAt: app.today()
    }

    app.addOrder(order)
    wx.showToast({ title: '创建成功', icon: 'success' })
    setTimeout(() => {
      const pages = getCurrentPages()
      if (pages.length > 1) wx.navigateBack()
      else wx.switchTab({ url: '/pages/orders/orders' })
    }, 700)
  }
})
