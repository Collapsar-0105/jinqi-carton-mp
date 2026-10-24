const app = getApp()

Page({
  data: {
    fontClass: '',
    kbHeight: 0,
    footerBottom: 0,
    isIOS: false,
    isEdit: false,
    originalName: '',
    name: '',
    contact: '',
    phone: '',
    addresses: []
  },

  onUnload() {
    if (this.kbHandler && wx.offKeyboardHeightChange) wx.offKeyboardHeightChange(this.kbHandler)
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass() })
  },

  onLoad(options) {
    const sys = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    this.setData({ isIOS: sys.platform === 'ios' })
    this.kbHandler = res => this.setData({ kbHeight: res.height, footerBottom: this.data.isIOS ? res.height : 0 })
    if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(this.kbHandler)

    const name = options && options.name ? decodeURIComponent(options.name) : ''
    if (name) {
      const c = app.getCustomer(name)
      if (c) {
        this.setData({
          isEdit: true,
          originalName: c.name,
          name: c.name,
          contact: c.contact || '',
          phone: c.phone || '',
          addresses: (c.addresses || []).map(a => ({ contact: a.contact || '', phone: a.phone || '', address: a.address || '' }))
        })
      }
    }
  },

  onField(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  addAddress() {
    this.setData({ addresses: this.data.addresses.concat([{ contact: '', phone: '', address: '' }]) })
  },
  removeAddress(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const addresses = this.data.addresses.slice()
    addresses.splice(idx, 1)
    this.setData({ addresses })
  },
  onAddressField(e) {
    const { index, field } = e.currentTarget.dataset
    const addresses = this.data.addresses.slice()
    addresses[Number(index)][field] = e.detail.value
    this.setData({ addresses })
  },

  save() {
    const name = (this.data.name || '').trim()
    if (!name) {
      wx.showToast({ title: '请输入客户名称', icon: 'none' })
      return
    }

    const origin = this.data.originalName
    let list = app.getCustomers()
    if (list.find(c => c.name === name && c.name !== origin)) {
      wx.showToast({ title: '客户已存在', icon: 'none' })
      return
    }

    const customer = {
      name,
      contact: (this.data.contact || '').trim(),
      phone: (this.data.phone || '').trim(),
      addresses: this.data.addresses
        .filter(a => (a.address || '').trim())
        .map(a => ({
          contact: (a.contact || '').trim(),
          phone: (a.phone || '').trim(),
          address: (a.address || '').trim()
        })),
      // 多设备合并按 updatedAt 定胜负，没有这个字段时排序依据退化
      updatedAt: Date.now()
    }

    if (origin) {
      list = list.filter(c => c.name !== origin)
      // 同步产品上的客户名
      if (origin !== name) {
        const products = app.getProducts().map(p => {
          if (!p.customers || p.customers.indexOf(origin) === -1) return p
          return Object.assign({}, p, {
            customers: p.customers.map(c => (c === origin ? name : c))
          })
        })
        app.saveProducts(products)
      }
    }
    list.push(customer)
    app.saveCustomers(list)

    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 500)
  },

  remove() {
    const name = this.data.originalName
    wx.showModal({
      title: '删除客户',
      content: '确定删除「' + name + '」吗？历史订单保留。',
      confirmColor: '#e94560',
      success: res => {
        if (res.confirm) {
          app.saveCustomers(app.getCustomers().filter(c => c.name !== name))
          const products = app.getProducts().map(p => {
            if (!p.customers || p.customers.indexOf(name) === -1) return p
            return Object.assign({}, p, { customers: p.customers.filter(c => c !== name) })
          })
          app.saveProducts(products)
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 500)
        }
      }
    })
  }
})
