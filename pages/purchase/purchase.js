const app = getApp()
const C = require('../../utils/constants.js')

Page({
  data: {
    fontClass: '',
    items: []
  },

  onShow() {
    if (wx.getStorageSync('role') === 'worker') { wx.switchTab({ url: '/pages/orders/orders' }); return } // __workerGuard
    const tb = this.getTabBar && this.getTabBar()
    if (tb) tb.setData({ selected: 1 })
    this.setData({ fontClass: app.getFontClass() })
    this.loadData()
  },

  loadData() {
    const data = app.getData()
    const items = []

    ;C.arr(data.orders).forEach(order => {
      if (order.status !== 'active' && order.status !== 'paused') return
      ;C.arr(order.items).forEach((it, itemIdx) => {
        C.arr(it.purchases).forEach((p, idx) => {
          if (p.status !== 'pending') return
          items.push({
            type: p.type || '其他',
            name: p.name,
            supplier: p.supplier,
            quantity: p.quantity,
            _key: order.id + '-' + itemIdx + '-' + idx,
            _index: idx,
            itemIndex: itemIdx,
            orderId: order.id,
            customer: order.customer,
            product: it.productName
          })
        })
      })
    })

    this.setData({ items })
  },

  markArrived(e) {
    const { orderId, item, index } = e.currentTarget.dataset
    app.updateOrder(orderId, (order) => {
      const p = order.items[item].purchases[index]
      p.status = 'done'
      p.arrivedAt = app.now()
    })
    wx.showToast({ title: '已标记到货', icon: 'success' })
    this.loadData()
  }
})
