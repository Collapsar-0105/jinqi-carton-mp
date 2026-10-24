const app = getApp()
const C = require('../../utils/constants.js')

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
    note: '',
    typeOptions: []
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
    let types = []
    if (name) {
      const s = app.getSupplier(name)
      if (s) {
        types = s.types || []
        this.setData({
          isEdit: true,
          originalName: s.name,
          name: s.name,
          contact: s.contact || '',
          phone: s.phone || '',
          note: s.note || ''
        })
      }
    }
    this.setData({
      typeOptions: C.SUPPLIER_TYPES.map(t => ({ name: t, checked: types.indexOf(t) > -1 }))
    })
  },

  onField(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  toggleType(e) {
    const t = e.currentTarget.dataset.name
    const options = this.data.typeOptions.map(o => {
      if (o.name !== t) return o
      return { name: o.name, checked: !o.checked }
    })
    this.setData({ typeOptions: options })
  },

  save() {
    const name = (this.data.name || '').trim()
    if (!name) {
      wx.showToast({ title: '请输入供应商名称', icon: 'none' })
      return
    }

    const list = app.getSuppliers()
    const others = list.filter(s => s.name !== this.data.originalName)
    if (others.find(s => s.name === name)) {
      wx.showToast({ title: '名称已存在', icon: 'none' })
      return
    }

    const types = this.data.typeOptions.filter(o => o.checked).map(o => o.name)
    const supplier = {
      name,
      contact: (this.data.contact || '').trim(),
      phone: (this.data.phone || '').trim(),
      types,
      note: (this.data.note || '').trim(),
      // 多设备合并按 updatedAt（毫秒数）定胜负；以前用 app.now() 是日期字符串，
      // Number('YYYY-MM-DD') 是 NaN，比较时全变 0，等于没有
      updatedAt: Date.now()
    }

    let next
    if (this.data.isEdit) {
      next = list.filter(s => s.name !== this.data.originalName).concat([supplier])
    } else {
      next = list.concat([supplier])
    }
    app.saveSuppliers(next)

    // 改名时同步订单里的代工厂名
    if (this.data.isEdit && this.data.originalName !== name) {
      const data = app.getData()
      let changed = false
      data.orders.forEach(o => {
        if (o.factoryName === this.data.originalName) { o.factoryName = name; changed = true }
        ;(o.purchases || []).forEach(p => {
          if (p.supplier === this.data.originalName) { p.supplier = name; changed = true }
        })
      })
      if (changed) app.saveData(data)
    }

    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 500)
  },

  remove() {
    wx.showModal({
      title: '删除供应商',
      content: '确定删除「' + this.data.originalName + '」吗？',
      confirmColor: '#e94560',
      success: res => {
        if (res.confirm) {
          app.saveSuppliers(app.getSuppliers().filter(s => s.name !== this.data.originalName))
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 500)
        }
      }
    })
  }
})
