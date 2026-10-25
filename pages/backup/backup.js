const app = getApp()
const C = require('../../utils/constants.js')

// 与 app.js 的 SYNC_KEYS 保持一致，别再漏字段（factory_list = 代工厂）
const KEYS = [
  'factory_data',
  'product_archive',
  'customer_list',
  'supplier_list',
  'sample_drafts',
  'stock_alerts',
  'work_years',
  'factory_list'
]

Page({
  data: {
    fontClass: '',
    version: C.APP_VERSION,
    counts: { orders: 0, products: 0, customers: 0, suppliers: 0 },
    lastBackup: '暂无',
    fontLevel: 0,
    isAdmin: false,
    launchErrors: [],
    cloud: { mode: 'local', error: '', lastSyncText: '-' },
    cloudEnv: '',
    workYears: []
  },

  // 非管理员：危险操作一律拦住
  requireAdmin() {
    if (this.data.isAdmin) return true
    wx.showToast({ title: '只有管理员可以操作', icon: 'none' })
    return false
  },
  archivePick() {
    if (!this.requireAdmin()) return
    const years = {}
    app.getAllOrders().forEach(o => {
      const y = (o.createdAt || '').slice(0, 4)
      if (y && o.status !== 'deleted') years[y] = (years[y] || 0) + 1
    })
    const list = Object.keys(years).sort()
    if (!list.length) {
      wx.showToast({ title: '没有可归档的订单', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: list.map(y => y + ' 年（' + years[y] + ' 单）'),
      success: r => {
        const year = list[r.tapIndex]
        wx.showModal({
          title: '归档 ' + year + ' 年',
          content: '把该年订单移到归档集合（数据保留，可在历史年份查看），不会删除。确定吗？',
          success: m => {
            if (!m.confirm) return
            wx.showLoading({ title: '归档中…' })
            app.cloudOrders().archive(year).then(res => {
              wx.hideLoading()
              if (!res || !res.ok) {
                wx.showModal({ title: '归档失败', content: (res && res.error) || '云端未部署新接口', showCancel: false })
                return
              }
              wx.showModal({ title: '完成', content: '已归档 ' + res.moved + ' 单', showCancel: false })
            }).catch(() => { wx.hideLoading(); wx.showToast({ title: '归档失败', icon: 'none' }) })
          }
        })
      }
    })
  },

  // 性能自检：把关键链路的耗时打出来，方便定位卡顿
  // 本机缓存救援：白屏/数据错乱/换机时用，只清本地，不动云端
  clearLocalCache() {
    wx.showModal({
      title: '清空本机缓存',
      content: '会清掉这台手机上的本地数据，然后重新从云端拉取。云端数据不受影响。',
      confirmColor: '#e94560',
      success: r => {
        if (!r.confirm) return
        KEYS.forEach(k => { try { wx.removeStorageSync(k) } catch (e) {} })
        try { wx.removeStorageSync('sync_updated_at') } catch (e) {}
        try { wx.removeStorageSync('pending_push') } catch (e) {}
        try { wx.removeStorageSync('subs_merged_v1') } catch (e) {}
        app.clearCache()
        wx.showToast({ title: '已清空，正在重登', icon: 'none' })
        setTimeout(() => wx.reLaunch({ url: '/pages/orders/orders' }), 800)
      }
    })
  },
  perfCheck() {
    const app2 = getApp()
    const out = []
    const time = (label, fn) => {
      const t = Date.now()
      try { fn() } catch (e) {}
      out.push(label + '：' + (Date.now() - t) + 'ms')
    }

    time('读整包数据', () => { for (let i = 0; i < 50; i++) app2.getData() })
    time('写本地存储', () => { for (let i = 0; i < 10; i++) app2.persistLocal(app2.getData()) })
    time('生成全部订单卡片', () => { app2.getAllOrders().forEach(o => app2.orderCardData(o)) })
    time('搜索一次（全部订单）', () => {
      app2.getAllOrders().forEach(o => app2.matchKeywords(app2.orderSearchText(o), '测试'))
    })

    const p = getCurrentPages()
    const cur = p[p.length - 1]
    let renderMs = '未测'
    const done = () => {
      wx.showModal({
        title: '性能自检',
        content: out.join('\n') + '\n页面渲染：' + renderMs + '\n订单数：' + app2.getAllOrders().length +
          '\n数据大小：' + Math.round((wx.getStorageSync('factory_data') || '').length / 1024) + 'KB',
        showCancel: false
      })
    }
    if (cur) {
      const t = Date.now()
      cur.setData({ __perfProbe: t }, () => { renderMs = (Date.now() - t) + 'ms'; done() })
    } else done()
  },
  // ===== 工作年设置（1.9.66 从独立页面搬进设置页） =====
  loadWorkYears() {
    const now = new Date().getFullYear()
    const cfg = app.getWorkYears()
    const list = []
    for (let y = now + 1; y >= now - 3; y--) {
      const c = cfg[String(y)] || {}
      list.push({ year: y, start: c.start || '', end: c.end || '' })
    }
    this.setData({ workYears: list })
  },

  onWorkStart(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const list = this.data.workYears.slice()
    list[idx].start = e.detail.value
    this.setData({ workYears: list })
    this.saveWorkYears()
  },

  onWorkEnd(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const list = this.data.workYears.slice()
    list[idx].end = e.detail.value
    this.setData({ workYears: list })
    this.saveWorkYears()
  },

  clearWorkEnd(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const list = this.data.workYears.slice()
    list[idx].end = ''
    this.setData({ workYears: list })
    this.saveWorkYears()
  },

  saveWorkYears() {
    const cfg = {}
    this.data.workYears.forEach(x => {
      if (x.start || x.end) cfg[String(x.year)] = { start: x.start, end: x.end }
    })
    app.saveWorkYears(cfg)
  },

  checkApi() {
    const c = app.globalData.cloud || {}
    if (!c.ready) { this.setData({ apiReadyText: '未连接云端' }); return }
    app.cloudCall('ordersList', { size: 1 }).then(res => {
      const ok = !!(res && res.ok)
      this.setData({ apiReadyText: ok ? '云端接口已就绪' : '云端接口未部署（需重传 data 云函数）' })
    }).catch(() => this.setData({ apiReadyText: '云端接口检测失败' }))
  },

  onShow() {
    this.loadWorkYears()
    // 启动异常直接摆出来，别让用户靠猜
    try {
      const errs = (app.globalData.launchErrors || [])
      this.setData({ launchErrors: errs })
    } catch (e) {}
    const role = wx.getStorageSync('role')
    const admin = !!((app.globalData.cloud && app.globalData.cloud.admin) || role === 'admin')
    this.setData({ isAdmin: admin })
    const orders = app.getAllOrders().filter(o => o.status !== 'deleted')
    const bytes = JSON.stringify(app.getData()).length
    this.setData({ usageText: orders.length + ' 单 / 约 ' + (bytes / 1024).toFixed(1) + ' KB' })
    this.checkApi()
    this.setData({ fontClass: app.getFontClass(), cloudEnv: wx.getStorageSync('cloud_env') || 'cloud1-d5gv2u5lo1ad3e74a' })
    this.refreshCloud()
    this.setData({ fontLevel: app.getFontLevel() })
    this.refresh()
  },

  setFont(e) {
    const lv = Number(e.currentTarget.dataset.level)
    wx.setStorageSync('font_level', lv)
    this.setData({ fontLevel: lv })
    wx.showToast({ title: lv === 0 ? '标准字号' : (lv === 1 ? '大字号' : '特大字号'), icon: 'none' })
  },

  onEnvInput(e) {
    this.setData({ cloudEnv: (e.detail.value || '').trim() })
  },

  saveEnv() {
    if (!this.requireAdmin()) return
    const env = (this.data.cloudEnv || '').trim()
    if (!env) { wx.showToast({ title: '请输入环境 ID', icon: 'none' }); return }
    wx.setStorageSync('cloud_env', env)
    app.initCloud()
    wx.showToast({ title: '已保存，正在连接', icon: 'none' })
    setTimeout(() => this.refreshCloud(), 1500)
  },

  refreshCloud() {
    const c = (app.globalData && app.globalData.cloud) || {}
    this.setData({
      cloud: {
        mode: c.mode || 'local',
        error: c.error || '',
        lastSyncText: c.lastSync ? new Date(c.lastSync).toLocaleString() : '-'
      }
    })
  },

  goUsers() {
    if (!this.requireAdmin()) return
    if (!app.globalData.cloud.admin) {
      wx.showToast({ title: '只有管理员能管理', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/users/users' })
  },

  clearCloud() {
    if (!this.requireAdmin()) return
    if (!app.globalData.cloud.admin) {
      wx.showToast({ title: '只有管理员能清空', icon: 'none' })
      return
    }
    wx.showModal({
      title: '清空云端数据',
      content: '只删除云端的备份。本机数据还在，下次保存会自动重新上传；想彻底重来请同时清空本机。',
      confirmColor: '#e94560',
      success: r => {
        if (!r.confirm) return
        wx.showLoading({ title: '清空中' })
        app.cloudCall('clearData').then(res => {
          wx.hideLoading()
          wx.showToast({ title: (res && res.ok) ? '云端已清空' : '清空失败', icon: 'none' })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '清空失败', icon: 'none' })
        })
      }
    })
  },

  resetAll() {
    if (!this.requireAdmin()) return
    if (!app.globalData.cloud.admin) {
      wx.showToast({ title: '只有管理员能重置', icon: 'none' })
      return
    }
    wx.showModal({
      title: '重置全部数据',
      content: '会删除本机和云端的全部订单、产品、客户、供应商、往来账。字体和云环境设置保留。此操作不可恢复。',
      confirmText: '确认重置',
      confirmColor: '#e94560',
      success: r => {
        if (!r.confirm) return
        wx.showLoading({ title: '重置中' })
        const keys = ['factory_data','product_archive','customer_list','supplier_list',
          'sample_drafts','stock_alerts','work_years','factory_list']
        app.cloudCall('clearData').then(() => {
          keys.forEach(k => { try { wx.removeStorageSync(k) } catch (e) {} })
      app.clearCache()
          try { wx.removeStorageSync('sync_updated_at') } catch (e) {}
          wx.hideLoading()
          wx.showToast({ title: '已重置', icon: 'success' })
          setTimeout(() => wx.switchTab({ url: '/pages/orders/orders' }), 800)
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '重置失败', icon: 'none' })
        })
      }
    })
  },

  pushCloud() {
    if (!this.requireAdmin()) return
    if (!app.globalData.cloud.ready) {
      wx.showToast({ title: '云端未连接', icon: 'none' })
      return
    }
    wx.showLoading({ title: '上传中' })
    app.cloudPush(true).then(res => {
      wx.hideLoading()
      if (!res || !res.ok) {
        wx.showModal({ title: '上传失败', content: (res && res.error) || '云端未连接', showCancel: false })
        return
      }
      wx.showToast({ title: '已上传', icon: 'success' })
      this.refreshCloud()
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '上传失败', icon: 'none' })
    })
  },

  pullCloud() {
    if (!app.globalData.cloud.ready) {
      wx.showToast({ title: '云端未连接', icon: 'none' })
      return
    }
    wx.showLoading({ title: '拉取中' })
    app.cloudPull(false, true).then(res => {
      // 这里点的是「拉取最新数据」，走全量
      app.syncOrdersFromCloud(true)
      wx.hideLoading()
      if (!res) {
        const c = app.globalData.cloud || {}
        wx.showModal({ title: '拉取失败', content: c.error || '云端未连接或未授权', showCancel: false })
        return
      }
      wx.showToast({ title: '已同步', icon: 'success' })
      setTimeout(() => wx.switchTab({ url: '/pages/orders/orders' }), 600)
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '拉取失败', icon: 'none' })
    })
  },

  refresh() {
    this.setData({
      counts: {
        orders: app.getAllOrders().length,
        products: app.getProducts().length,
        customers: app.getCustomers().length,
        suppliers: app.getSuppliers().length
      },
      lastBackup: wx.getStorageSync('last_backup_at') || '暂无'
    })
  },

  // 导出：生成 JSON 文件并发送到微信聊天（文件传输助手等）
  exportData() {
    if (!this.requireAdmin()) return
    const payload = {
      app: '金淇纸箱',
      version: C.APP_VERSION,
      exportedAt: app.now(),
      data: {}
    }
    KEYS.forEach(k => { payload.data[k] = wx.getStorageSync(k) || '' })

    const text = JSON.stringify(payload)
    const fileName = '金淇纸箱备份_' + app.now() + '.json'
    const filePath = wx.env.USER_DATA_PATH + '/' + fileName

    try {
      wx.getFileSystemManager().writeFileSync(filePath, text, 'utf8')
    } catch (e) {
      // 写文件失败就退回复制文本
      wx.setClipboardData({
        data: text,
        success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
      })
      return
    }

    wx.setStorageSync('last_backup_at', app.now())

    if (wx.shareFileMessage) {
      wx.shareFileMessage({
        filePath,
        fileName,
        success: () => wx.showToast({ title: '已发送，请存到文件传输助手', icon: 'none' }),
        fail: () => this.copyText(text)
      })
    } else {
      this.copyText(text)
    }
  },

  copyText(text) {
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制备份内容', icon: 'none' })
    })
  },

  // 仅复制文本（数据量大时用）
  copyData() {
    if (!this.requireAdmin()) return
    const payload = { app: '金淇纸箱', version: C.APP_VERSION, exportedAt: app.now(), data: {} }
    KEYS.forEach(k => { payload.data[k] = wx.getStorageSync(k) || '' })
    this.copyText(JSON.stringify(payload))
  },

  importData() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: res => {
        const file = (res.tempFiles || [])[0]
        if (!file) return
        let text = ''
        try {
          text = wx.getFileSystemManager().readFileSync(file.path, 'utf8')
        } catch (e) {
          wx.showToast({ title: '读取文件失败', icon: 'none' })
          return
        }

        let payload = null
        try { payload = JSON.parse(text) } catch (e) {}
        if (!payload || !payload.data) {
          wx.showModal({
            title: '文件格式不对',
            content: '请选择本小程序导出的备份 json 文件。',
            showCancel: false
          })
          return
        }

        const d = payload.data
        const orderCount = (() => {
          try { return (JSON.parse(d.factory_data || '{}').orders || []).length } catch (e) { return 0 }
        })()

        wx.showModal({
          title: '确认导入',
          content: '将用备份覆盖当前数据（订单 ' + orderCount + ' 张、备份时间 ' + (payload.exportedAt || '未知') + '），当前数据会被替换，确定吗？',
          confirmText: '覆盖导入',
          confirmColor: '#e94560',
          success: r => {
            if (!r.confirm) return
            KEYS.forEach(k => {
              if (d[k] !== undefined && d[k] !== '') wx.setStorageSync(k, d[k])
            })
            // 直接改过 storage，必须清掉内存缓存，否则界面还是旧数据
            app.clearCache()
            wx.showToast({ title: '导入完成', icon: 'success' })
            setTimeout(() => wx.switchTab({ url: '/pages/orders/orders' }), 800)
          }
        })
      }
    })
  }
})
