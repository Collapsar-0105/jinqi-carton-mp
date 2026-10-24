const app = getApp()
const C = require('../../utils/constants.js')

Page({
  data: {
    fontClass: '',
    orderId: '',
    order: null,
    items: [],
    elapsed: 0,
    undoToast: '',
    totalQty: 0,
    sentQty: 0,
    completedRatio: 0,
    canStock: false,
    stockEarly: false,
    allStocked: false,
    addr: {}
  },

  onLoad(options) {
    // 先拿到 id 再拉云端，否则会拿 undefined 发一次空请求，还把节流时间占掉
    this.setData({ orderId: options.id || '' }, () => {
      if (this.data.orderId) this.refreshFromCloud()
    })
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass() })
    this.loadOrder()
  },

  loadOrder() {
    const order = app.getOrder(this.data.orderId)
    if (!order) {
      wx.showToast({ title: '订单不存在', icon: 'none' })
      wx.navigateBack()
      return
    }

    const customer = app.getCustomer(order.customer) || {}
    const addr = (customer.addresses && customer.addresses.length) ? customer.addresses[0] : {}

    const isSub = !!order.isSub
    const items = (order.items || []).map((it, idx) => {
      const qty = Number(it.quantity) || 0
      const DEAD = ['开手扣孔', '内衬格挡', '垫片']
      // 子单是已入库成品，不再走工序
      const rawSteps = isSub ? [] : (it.steps || [])
        .map((s, i) => Object.assign({}, s, { i }))
        .filter(s => DEAD.indexOf(s.name) === -1)
        .filter(s => !(it.stocked && s.status === 'done'))
      const itemTotal = Number(it.originalQty) || qty || (Number(it.splitQty) || 0) || 0
      const leftQty = qty || itemTotal
      let minDone = leftQty
      ;(it.steps || []).forEach(s => {
        const v = (s.status === 'done' && !Number(s.doneQty)) ? itemTotal : (Number(s.doneQty) || 0)
        if (v < minDone) minDone = v
      })
      const steps = rawSteps.map(s => {
        const dq = Number(s.doneQty) || 0
        const needQty = C.QTY_STEPS.indexOf(s.name) > -1
        let text = '待开始'
        if (s.status === 'done') text = needQty ? ('已完成 ' + dq + ' 个') : '已完成'
        else if (s.status === 'in_progress') text = needQty ? ('进行中（已填 ' + dq + '）') : '进行中'
        return {
          i: s.i,
          name: s.name,
          status: s.status,
          doneQty: dq,
          needQty,
          _statusText: text
        }
      })
      const doneCount = steps.filter(s => s.status === 'done').length
      const progress = steps.length ? Math.round(doneCount / steps.length * 100) : 0
      const delivered = Number(it.deliveredQty) || 0
      const allDone = steps.length > 0 && steps.every(s => s.status === 'done')

      const prod = app.getProduct(it.productId)
      const note = (prod && prod.note) ? String(prod.note).trim() : ''

      const sizeText = it.boxType === '梯形箱'
        ? '上' + it.sizeTL + '×' + it.sizeTW + ' 中高' + it.sizeH2 + ' 下' + it.sizeBL + '×' + it.sizeBW + 'mm'
        : it.sizeL + '×' + it.sizeW + '×' + it.sizeH + 'mm'


      return Object.assign({}, it, {
        idx,
        steps,
        progress,
        delivered,
        shipments: (function() {
          const addrList = app.itemAddrList(order, it)
          return (order.shipments || []).map(s => {
            const row = (s.items || []).find(r => r.index === idx)
            if (!row) return null
            const ai = (row.addrIndex == null) ? 0 : Number(row.addrIndex)
            const a = addrList[ai] || {}
            return {
              date: s.date,
              qty: row.qty,
              // 多地址时写明送到哪；单地址不显示地址免得啰嗦
              addrText: (addrList.length > 1) ? (a.address || '未指定地址') : ''
            }
          }).filter(Boolean)
        })(),
        remainQty: app.shippableQty(order, it),
        producedQty: app.producedQtyOf(it),
        overQty: Math.max(0, app.producedQtyOf(it) - qty),
        // 只在「还有别的款没入库」时才给单款入库按钮；只剩最后一款交给底部按钮，避免两个按钮做同一件事
        canStockItem: !isSub && !it.stocked && order.status !== 'done' && app.canStockItem(it)
          && (order.items || []).filter(x => !x.stocked).length > 1,
        // 保留 1 位小数：round 后 89.8% 会显示成 90%，和 90% 才能入库的规则对不上，让人困惑
        itemRatioPct: Math.round(app.itemRatio(it) * 1000) / 10,
        stockLeft: (order.items || []).filter(x => !x.stocked).length,
        originalQty: isSub ? qty : (Number(it.originalQty) || (qty + (Number(it.splitQty) || 0))),
        splitQty: isSub ? 0 : (Number(it.splitQty) || 0),
        _sizeText: sizeText,
        addrList: app.itemAddrList(order, it),
        note
      })
    })

    const totalQty = app.orderQty(order)
    const sentQty = app.shippedQty(order)
    const elapsed = app.elapsedDays(order)
    const ratio = app.completedRatio(order)
    const canStock = app.canStockIn(order)

    // 只把模板用得到的订单字段发过去，不要整个 order（里面有 items/shipments，白传一遍）
    const orderView = {
      id: order.id,
      customer: order.customer,
      createdAt: order.createdAt,
      status: order.status,
      isSub: !!order.isSub,
      isSample: !!order.isSample,
      urgent: !!order.urgent,
      earlyFinish: !!order.earlyFinish,
      earlyReason: order.earlyReason || '',
      shortQty: order.shortQty || 0
    }

    this.setData({
      order: orderView,
      items,
      addr,
      elapsed,
      totalQty,
      sentQty,
      completedRatio: Math.round(ratio * 100),
      canStock,
      stockEarly: canStock && items.some(x => !x.stocked && app.completedQtyOf(x) < (Number(x.quantity) || 0)),
      canUndo: app.canUndo(),
      isWorker: wx.getStorageSync('role') === 'worker',
      allStocked: app.allStocked(order)
    })
  },

  refreshFromCloud() {
    const now = Date.now()
    if (this._lastPull && now - this._lastPull < 10000) return
    this._lastPull = now

    const c = app.globalData.cloud || {}
    if (!c.ready) return
    const local = app.getOrder(this.data.orderId)
    if (local) return
    app.cloudOrders().get(this.data.orderId).then(res => {
      if (!res || !res.ok || !res.order) return
      app.saveOrderLocal(Object.assign({}, res.order, { id: res.order._id || res.order.id }))
      this.loadOrder()
    }).catch(() => {})
  },

  startStep(e) {
    const { item, step } = e.currentTarget.dataset
    app.updateOrder(this.data.orderId, order => {
      order.items[item].steps[step].status = 'in_progress'
    }, '开始工序 ' + (this.data.items[item].steps[step].name || ''))
    this.loadOrder()
  },

  doneStep(e) {
    const { item, step } = e.currentTarget.dataset
    const it = this.data.items[item]
    const st = it && it.steps[step]
    if (!st) return

    // 只有纸板到货、面纸印刷要填数量；其它工序点一下就完成，数量自动跟着走
    if (!app.stepNeedsQty(st.name)) {
      if (!app.stepBaseQty(it)) {
        wx.showToast({ title: '先完成纸板到货', icon: 'none' })
        return
      }
      this.completeStep(item, step, null)
      return
    }

    // 允许超量制作：上限是订单数量 × 1.1。
    // 注意 1.9.38 起完成数量是「覆盖」不是「累加」，所以校验上限是 limit 本身；
    // 以前用 limit - doneQty，想把 449 改成 500 会被拦住（只剩 101 的额度）
    const limit = app.stockLimitOf(it)
    const label = st.name === '纸板到货' ? '到货数量'
      : st.name === '面纸印刷' ? '印刷数量'
      : st.name === '代工' ? '实际回来数量'
      : '完成数量'

    wx.showModal({
      title: st.name + ' · ' + label,
      editable: true,
      fail: () => wx.showToast({ title: '输入框打不开，请更新微信', icon: 'none' }),
      placeholderText: '最多 ' + limit + '（订单 ' + (Number(it.quantity) || 0) + '，可超 10%）',
      success: res => {
        if (!res.confirm) return
        const qty = parseInt(res.content)
        if (!qty || qty <= 0) { wx.showToast({ title: '请输入有效数量', icon: 'none' }); return }
        if (qty > limit) { wx.showToast({ title: '最多 ' + limit, icon: 'none' }); return }
        this.completeStep(item, step, qty)
      }
    })
  },

  // qty 传 null 表示不用填数量，自动取「纸板到货 / 面纸印刷」定下的数量
  completeStep(item, step, qty) {
    const name = (this.data.items[item].steps[step] || {}).name || '工序'
    app.updateOrder(this.data.orderId, order => {
      const it = order.items[item]
      const s = it.steps[step]
      s.status = 'done'
      if (qty == null) {
        s.doneQty = app.stepBaseQty(it)
      } else {
        const cap = app.stockLimitOf(it)
        s.doneQty = Math.min(cap, Math.max(0, Number(qty) || 0))
      }
    }, '完成' + name + (qty == null ? '' : ' ' + qty + ' 个'))
    wx.showToast({ title: '已完成', icon: 'success' })
    this.loadOrder()
  },

  copyInfo(e) {
    const idx = Number(e.currentTarget.dataset.item)
    const it = this.data.items[idx]
    if (!it) return

    const qty = Number(it.quantity) || 0
    const boardQty = it.twoPiece ? (qty * 2 + 5) : (qty + 5)

    const lines = [
      '产品：' + it.productId + ' ' + it.productName,
      '箱型：' + (it.boxType || ''),
      '楞型：' + (it.flute || '')
    ]
    if (it.po) lines.push('PO：' + it.po)
    lines.push(
      '面纸颜色：' + (it.paperColor || ''),
      '纸板尺寸：' + it.boardL + '×' + it.boardW + '×' + (it.sizeH || 0) + 'mm',
      '纸板数量：' + boardQty + ' 张'
    )
    if (this.data.order.urgent) lines.unshift('【加急！加急！】')

    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '纸板信息已复制', icon: 'success' })
    })
  },

  copyProductInfo(e) {
    const it = this.data.items[Number(e.currentTarget.dataset.item)]
    if (!it) return
    const lines = [
      '产品：' + it.productId + ' ' + it.productName,
      '箱型：' + (it.boxType || ''),
      '楞型：' + (it.flute || ''),
      '尺寸：' + it._sizeText,
      '数量：' + (Number(it.quantity) || 0) + ' 个',
      '单价：¥' + (Number(it.price) || 0) + '/个'
    ]
    if (it.po) lines.splice(1, 0, 'PO：' + it.po)
    if (this.data.order.urgent) lines.unshift('【加急！加急！】')
    lines.push('送货：')
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '产品信息已复制', icon: 'success' })
    })
  },

  copyDelivery(e) {
    const idx = Number(e.currentTarget.dataset.item)
    const it = this.data.items[idx]
    if (!it) return
    // 复制哪个地址的送货单（多地址时按钮各带一个）
    const ai = Number(e.currentTarget.dataset.ai) || 0
    const a = (it.addrList && it.addrList[ai]) ? it.addrList[ai] : (this.data.addr || {})
    const pads = (it.pads || []).map(p => p.type + ' ' + p.L + '×' + p.W + ' ×' + p.qty).join('；')
    const d = new Date()

    const lines = [
      '日期：' + (d.getMonth() + 1) + '-' + d.getDate(),
      '客户：' + (this.data.order.customer || ''),
      '产品：' + it.productId + ' ' + it.productName,
      '箱型：' + (it.boxType || '')
    ]
    if (it.po) lines.push('PO：' + it.po)
    lines.push(
      '面纸颜色：' + (it.paperColor || ''),
      '尺寸：' + it._sizeText,
      '垫片：' + (pads || '无'),
      '收货地址：' + (a.address || '') + '  收货联系人：' + (a.contact || '') + ' ' + (a.phone || '')
    )
    if (it.note) lines.push('备注：' + it.note)
    lines.push('送货数：', '送货人：')

    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '送货信息已复制', icon: 'success' })
    })
  },

  togglePause() {
    const paused = this.data.order.status === 'paused'
    wx.showModal({
      title: paused ? '恢复订单' : '暂缓订单',
      content: paused ? '恢复后按原流程继续。' : '暂缓后工序不再推进，数据保留。',
      success: res => {
        if (!res.confirm) return
        app.updateOrder(this.data.orderId, order => {
          order.status = paused ? 'active' : 'paused'
        }, paused ? '恢复订单' : '暂缓订单')
        this.loadOrder()
      }
    })
  },

  // 单款入库：这一款达到 90% 就能入库；不是最后一款就拆子单
  stockItem(e) {
    const idx = Number(e.currentTarget.dataset.item)
    const it = this.data.items[idx]
    if (!it || !it.canStockItem) return
    const limit = app.stockLimitOf(it)
    const def = Math.min(app.completedQtyOf(it), limit)
    const alone = it.stockLeft <= 1
    wx.showModal({
      title: (alone ? '整单入库 · ' : '入库这款 · ') + it.productName,
      editable: true,
      content: String(def),
      fail: () => wx.showToast({ title: '输入框打不开，请更新微信', icon: 'none' }),
      placeholderText: '入库数量（最多 ' + limit + ' 个，订单 ' + it.quantity + ' 个 +10%）',
      success: res => {
        if (!res.confirm) return
        const qty = parseInt(res.content)
        if (!qty || qty <= 0) { wx.showToast({ title: '请输入数量', icon: 'none' }); return }
        if (qty > limit) { wx.showToast({ title: '最多 ' + limit + ' 个', icon: 'none' }); return }
        app.stockItemIn(this.data.orderId, idx, qty)
        wx.showToast({ title: alone ? '已入库' : '已拆子单入库', icon: 'success' })
        this.loadOrder()
      }
    })
  },

  toggleUrgent() {
    const next = !this.data.order.urgent
    app.setUrgentTree(this.data.orderId, next, next ? '标记加急' : '取消加急')
    wx.showToast({ title: next ? '已标记加急' : '已取消加急', icon: 'none' })
    this.loadOrder()
  },

  undoLast() {
    const item = app.undoLast()
    if (!item) { wx.showToast({ title: '没有可撤销的操作', icon: 'none' }); return }
    const label = item.label || '上一步操作'
    this.setData({ undoToast: '已撤销：' + label })
    wx.showToast({ title: '已撤销：' + label, icon: 'none', duration: 2200 })
    this.loadOrder()
    clearTimeout(this._undoTimer)
    this._undoTimer = setTimeout(() => this.setData({ undoToast: '' }), 2800)
  },

  // 入库：数量按实际完成填，允许超量 10%
  stockIn() {
    // 必须拿完整订单：this.data.order 是 loadOrder 投影的 orderView，没有 items/shipments，
    // 拿它算 targets 会恒为空、直接走「已经入库了」分支，整单入库就废了
    const order = app.getOrder(this.data.orderId) || this.data.order
    const hasSubs = app.hasSubOrders(order.id)

    if (hasSubs) {
      wx.showModal({
        title: '标记为已入库',
        content: '这单有拆出去的子单，确认后会把子单合并进母单（数量合并），之后只走送货。',
        success: res => {
          if (!res.confirm) return
          app.mergeSubOrders(order.id)
          app.stockIn(order.id)
          wx.showToast({ title: '子单已合并入库', icon: 'success' })
          this.loadOrder()
        }
      })
      return
    }

    const targets = []
    ;(order.items || []).forEach((it, i) => { if (!it.stocked) targets.push({ i, it }) })
    if (!targets.length) { wx.showToast({ title: '已经入库了', icon: 'none' }); return }

    const qtys = {}
    const ask = idx => {
      if (idx >= targets.length) {
        app.stockIn(order.id, qtys)
        wx.showToast({ title: '已入库', icon: 'success' })
        this.loadOrder()
        return
      }
      const t = targets[idx]
      const done = app.completedQtyOf(t.it)
      const ordered = Number(t.it.quantity) || 0
      const limit = app.stockLimitOf(t.it)
      wx.showModal({
        title: '入库 · ' + (t.it.productName || '产品'),
        editable: true,
        placeholderText: '实际入库数量（完成 ' + done + '，订单 ' + ordered + '，最多 ' + limit + '）',
        fail: () => wx.showToast({ title: '输入框打不开，请更新微信', icon: 'none' }),
        success: res => {
          if (!res.confirm) return
          let qty = parseInt(res.content)
          if (!qty || qty <= 0) qty = done
          if (qty > limit) {
            wx.showToast({ title: '最多 ' + limit + ' 个（订单 +10%）', icon: 'none' })
            return
          }
          qtys[t.i] = qty
          ask(idx + 1)
        }
      })
    }
    ask(0)
  },

  deliver(e) {
    const idx = Number(e.currentTarget.dataset.item)
    const ai = Number(e.currentTarget.dataset.ai) || 0
    const it = this.data.items[idx]
    if (!it || it.remainQty <= 0) return
    const addr = (it.addrList || [])[ai]
    wx.showModal({
      title: '送货 · ' + it.productName + (addr && (it.addrList || []).length > 1 ? '（' + addr.address + '）' : ''),
      editable: true,
      fail: () => wx.showToast({ title: '输入框打不开，请更新微信', icon: 'none' }),
      placeholderText: '本次送货数量（这一款还剩 ' + it.remainQty + '）',
      success: res => {
        if (!res.confirm) return
        const qty = parseInt(res.content)
        if (!qty || qty <= 0) { wx.showToast({ title: '请输入数量', icon: 'none' }); return }
        if (qty > it.remainQty) { wx.showToast({ title: '超过剩余数量', icon: 'none' }); return }
        app.addShipment(this.data.orderId, [{ index: idx, qty, addrIndex: ai }], '送货 ' + qty + ' 个')

        const updated = app.getOrder(this.data.orderId)
        ;(updated.items || []).forEach(x => {
          const p = app.getProduct(x.productId)
          if (p && p.stockItem && (Number(x.deliveredQty) || 0) >= (Number(x.quantity) || 0)) {
            app.addStockAlert(x.productId, updated.id, x.quantity)
          }
        })

        wx.showToast({ title: '已送货', icon: 'success' })
        this.loadOrder()
      }
    })
  },

  deleteOrder() {
    wx.showModal({
      title: '确认删除',
      content: '删除后可以在订单页顶部点「撤销」恢复',
      confirmColor: '#e94560',
      success: res => {
        if (res.confirm) {
          app.updateOrder(this.data.orderId, order => { order.status = 'deleted' })
          app.setLastUndoLabel('删除订单')
          app.removeOrderCloud(this.data.orderId)
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 600)
        }
      }
    })
  }
})
