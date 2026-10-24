const app = getApp()

Page({
  data: {
    fontClass: '',
    name: '',
    customer: {},
    addresses: [],
    groups: [],
    total: 0,
    sortIndex: 0,
    sorts: ['编号', '地址', '销量', '日期'],
    collapsed: {}
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

    const addrs = (customer.addresses || []).map(a => a.address).filter(Boolean)
    const addrOf = o => o.address || addrs[0] || '未指定地址'
    const sales = o => (o.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0)

    const idx = this.data.sortIndex
    orders.sort((a, b) => {
      if (idx === 0) return String(a.id).localeCompare(String(b.id))
      if (idx === 1) return addrOf(a).localeCompare(addrOf(b))
      if (idx === 2) return sales(b) - sales(a)
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    })

    const map = {}
    orders.forEach(o => {
      const k = addrOf(o)
      if (!map[k]) map[k] = []
      map[k].push(o)
    })

    const collapsed = this.data.collapsed
    const groups = Object.keys(map).map(k => ({
      key: k,
      title: k,
      count: map[k].length,
      collapsed: !!collapsed[k],
      items: map[k].map(o => app.orderCardData(o))
    }))

    this.setData({
      customer,
      addresses: customer.addresses || [],
      groups,
      total: orders.length
    })
  },

  toggle(e) {
    const k = e.currentTarget.dataset.key
    const collapsed = Object.assign({}, this.data.collapsed)
    collapsed[k] = !collapsed[k]
    this.setData({ collapsed }, () => this.load())
  },

  setSort(e) {
    this.setData({ sortIndex: Number(e.currentTarget.dataset.index) }, () => this.load())
  },

  goOrder(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  goEdit() {
    wx.navigateTo({ url: '/pages/customer-edit/customer-edit?name=' + encodeURIComponent(this.data.name) })
  },

  call(e) {
    wx.makePhoneCall({ phoneNumber: String(e.currentTarget.dataset.phone || '') })
  }
})