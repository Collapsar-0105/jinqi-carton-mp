const app = getApp()

Page({
  data: {
    fontClass: '',
    name: '',
    customer: {},
    orders: [],
    total: 0,
    sortIndex: 0,
    sorts: ['编号', '销量', '日期']
  },

  onLoad(options) {
    this.setData({ name: decodeURIComponent(options.name || '') })
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass() })
    this.load()
  },

  load() {
    const name = this.data.name
    const customer = app.getCustomer(name) || {}
    const orders = app.getAllOrders().filter(o =>
      o.customer === name && !o.isSample && o.status !== 'deleted')

    const sales = o => (o.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0)

    const idx = this.data.sortIndex
    orders.sort((a, b) => {
      if (idx === 0) return String(a.id).localeCompare(String(b.id))
      if (idx === 1) return sales(b) - sales(a)
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    })

    // 收货地址已移除（1.9.101）：不再按地址分组，直接一个列表
    this.setData({
      customer,
      orders: orders.map(o => app.orderCardData(o)),
      total: orders.length
    })
  },

  setSort(e) {
    this.setData({ sortIndex: Number(e.currentTarget.dataset.index) }, () => this.load())
  },

  goOrder(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  goEdit() {
    wx.navigateTo({ url: '/pages/customer-edit/customer-edit?name=' + encodeURIComponent(this.data.name) })
  }
})