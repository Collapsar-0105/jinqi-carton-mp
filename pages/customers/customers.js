const app = getApp()

Page({
  data: {
    fontClass: '',
    list: []
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass(), undoLabel: app.undoLabel() })
    this.refresh()
  },

  refresh() {
    const orders = app.getAllOrders()

    const list = app.getCustomers().map(c => {
      const done = orders.filter(o => o.customer === c.name && o.status === 'done')
      return {
        name: c.name,
        contact: c.contact || '',
        phone: c.phone || '',
        doneCount: done.length
      }
    })

    this.setData({ list })
  },

  goNew() {
    wx.navigateTo({ url: '/pages/customer-edit/customer-edit' })
  },

  goEdit(e) {
    const name = e.currentTarget.dataset.name
    wx.navigateTo({ url: '/pages/customer-edit/customer-edit?name=' + encodeURIComponent(name) })
  },

  undoLast() {
    const item = app.undoLast()
    if (!item) { this.setData({ undoLabel: '' }); return }
    wx.showToast({ title: '已撤销', icon: 'success' })
    this.setData({ undoLabel: app.undoLabel() })
    this.refresh()
  },

  goDetail(e) {
    const name = e.currentTarget.dataset.name
    wx.navigateTo({ url: '/pages/customer-detail/customer-detail?name=' + encodeURIComponent(name) })
  },

  remove(e) {
    const name = e.currentTarget.dataset.name
    wx.showModal({
      title: '删除客户',
      content: '确定删除「' + name + '」吗？产品上的关联会一起移除，历史订单保留。',
      confirmColor: '#e94560',
      success: res => {
        if (res.confirm) {
          app.recordUndo('customers', app.getCustomers(), '删除客户')
          app.saveCustomers(app.getCustomers().filter(c => c.name !== name))
          const products = app.getProducts().map(p => {
            if (!p.customers || p.customers.indexOf(name) === -1) return p
            return Object.assign({}, p, { customers: p.customers.filter(c => c !== name) })
          })
          app.saveProducts(products)
          this.refresh()
        }
      }
    })
  }
})
