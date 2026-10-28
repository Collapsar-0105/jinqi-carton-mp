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
      // 换客户后：地址只能取新客户的，重新生成
      const items = this.data.items.map(it => {
        const p = app.getProduct(it.productId) || {}
        return Object.assign({}, it, this.buildAddrState(this.data.customer, p, it.quantity))
      })
      this.setData({ items }, () => this.syncAddrDerived())
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
    const suppliers = app.getSuppliers()

    // 纸板尺寸按公式重算，避免产品档案里的旧值不准
    const tang = p.tang != null ? Number(p.tang) : C.defaultTang(p.boxType || '')
    // 手填纸板的箱型（梯形箱/连体/异型箱）：纸板尺寸直接用档案里的值，不按公式推
    const manualBoard = C.MANUAL_BOARD_TYPES.indexOf(p.boxType || '') >= 0
    const board = manualBoard
      ? { length: p.boardL || 0, width: p.boardW || 0, twoPiece: true }
      : C.calcBoard(p.sizeL, p.sizeW, p.sizeH, tang, p.craft)

    const pads = (p.pads && p.pads.length)
      ? p.pads.map(x => ({ type: x.type, L: x.L, W: x.W, qty: x.qty }))
      : (p.padType ? [{ type: p.padType, L: p.padL || 0, W: p.padW || 0, qty: p.padQty || 0 }] : [])

    const steps = C.normalizeSteps(p.steps && p.steps.length ? p.steps : C.defaultSteps(p.craft || '草箱'))

    // 一款由多种规格纸板做成时，「纸板到货」按纸板种类拆成多道，各记各的数量
    const boards = (p.boards || []).filter(b => b && (b.L || b.W)).map(b => ({
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

    const materials = (p.materials || []).map(m => {
      const matched = suppliers.filter(s => (s.types || []).indexOf(m.type) > -1)
      return {
        type: m.type,
        name: m.name,
        price: m.price || 0,
        supplier: (matched[0] || {}).name || '',
        options: (matched.length ? matched : suppliers).map(s => s.name),
        supplierIndex: 0,
        quantity: ''
      }
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
      // 附加纸板（一款由多种不同规格纸板做成时，选产品就要一起带过来）
      boards: (p.boards || []).filter(b => b && (b.L || b.W)).map(b => ({
        L: Number(b.L) || 0,
        W: Number(b.W) || 0,
        qty: Number(b.qty) || 1
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
      purchases: materials,
      steps: stepList,
      // 该产品当前还剩多少可送（已入库未送完 + 超量多出来的），选品时算一次，
      // 填单过程中库存不会变，不用反复重算
      stockQty: app.productStockQty(p.id)
    }

    // 纸板命名：多张纸板时主纸板=大板、第2张=小板、第3张起=附加纸板A/B…
    const bNames = C.boardNames(1 + (item.boards || []).length)
    item.boardName = bNames[0] || ''
    item.boardNames = bNames.slice(1)

    // 收货地址：默认带出产品档案预设的（必须属于本单客户）
    Object.assign(item, this.buildAddrState(this.data.customer, p, ''))

    this.setData({ items: this.data.items.concat([item]) }, () => this.syncAddrDerived())

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

  // ---------- 收货地址 ----------
  buildAddrState(customerName, product, quantity) {
    const opts = app.customerAddresses(customerName).map(a => ({
      address: a.address, contact: a.contact || '', phone: a.phone || '', label: a.address
    }))
    const def = app.defaultAddrFor(product, customerName)
    let idx = 0
    if (def) {
      const i = opts.findIndex(o => o.address === def.address)
      if (i > -1) idx = i
    }
    const q = quantity ? String(quantity) : ''
    const list = opts.map((o, i) => ({
      address: o.address, contact: o.contact, phone: o.phone,
      qty: i === idx ? q : ''
    }))
    return { addrOptions: opts, addrIndex: idx, addrList: list, addrSum: 0, unassignedQty: 0, addrTipText: '' }
  },

  // 汇总每款的地址分配（允许只分一部分，剩下的算未分配）
  syncAddrDerived() {
    const items = this.data.items.map(it => {
      const list = it.addrList || []
      const sum = list.reduce((s, a) => s + (Number(a.qty) || 0), 0)
      const q = parseInt(it.quantity) || 0
      const unassigned = Math.max(0, q - sum)
      let tip = ''
      if (list.length > 1) {
        tip = unassigned > 0
          ? ('已分配 ' + sum + ' / 订单 ' + q + '，剩余 ' + unassigned + ' 未分配（可留空先备货）')
          : ('已全部分配 ' + sum + ' / 订单 ' + q)
      }
      return Object.assign({}, it, { addrSum: sum, unassignedQty: unassigned, addrTipText: tip })
    })
    this.setData({ items })
  },

  onAddrQty(e) {
    const { index, ai } = e.currentTarget.dataset
    const items = [...this.data.items]
    const it = items[Number(index)]
    if (!it || !it.addrList || !it.addrList[Number(ai)]) return
    it.addrList[Number(ai)].qty = e.detail.value
    this.setData({ items }, () => this.syncAddrDerived())
  },

  // 数量变了：单地址直接同步；多地址若还没分配，就全部预填给默认地址
  setSingleAddrQty(it) {
    const list = it.addrList || []
    if (!list.length) return
    const q = it.quantity ? String(it.quantity) : ''
    if (list.length === 1) { list[0].qty = q; return }
    const sum = list.reduce((s, a) => s + (Number(a.qty) || 0), 0)
    if (!sum && q) {
      const i = Number(it.addrIndex) || 0
      if (list[i]) list[i].qty = q
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
    if (field === 'quantity') this.setSingleAddrQty(items[index])
    this.setData({ items }, () => this.syncAddrDerived())
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
      // 地址分配：允许少分（剩下的算未分配，客户还没定送哪，先备货），但不能超过订单数量
      const opts = it.addrOptions || []
      if (opts.length) {
        const q = parseInt(it.quantity) || 0
        const sum = (it.addrList || []).reduce((s, a) => s + (Number(a.qty) || 0), 0)
        if (sum > q) {
          wx.showToast({ title: '第 ' + (i + 1) + ' 款分配 ' + sum + ' 超过数量 ' + q, icon: 'none' })
          return
        }
      }
    }

    const order = {
      customer: d.customer || '其他',
      orderNo: (d.orderNo || '').trim(),
      address: (() => {
        const c = app.getCustomer(d.customerNames[d.customerIndex] || '')
        const a = (c && c.addresses && c.addresses[0]) || {}
        return a.address || ''
      })(),
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
      // 附加纸板：从别处复制/带入的明细也要带上
      boards: (it.boards || []).filter(b => b && (b.L || b.W)).map(b => ({
        L: Number(b.L) || 0,
        W: Number(b.W) || 0,
        qty: Number(b.qty) || 1
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
        deliveredQty: 0,
        addrList: (it.addrList || [])
          .filter(a => Number(a.qty) > 0)
          .map(a => ({ address: a.address, contact: a.contact || '', phone: a.phone || '', qty: Number(a.qty) }))
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
