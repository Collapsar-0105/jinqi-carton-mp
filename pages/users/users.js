const app = getApp()

Page({
  data: {
    fontClass: '',
    list: [],
    loading: true,
    error: '',
    isAdmin: false
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass() })
    this.load()
  },

  load(depth) {
    const d = Number(depth) || 0
    const c = (app.globalData && app.globalData.cloud) || {}
    if (c.mode !== 'cloud') {
      this.setData({
        loading: false,
        error: c.mode === 'pending' ? '等待管理员授权' : (c.error || '云端未连接'),
        isAdmin: false
      })
      // 云端还在初始化：过 1.5 秒再试一次
      if (c.mode === 'pending' && d < 3) {
        clearTimeout(this._retry)
        this._retry = setTimeout(() => this.load(d + 1), 1500)
      }
      return
    }
    this.setData({ loading: true, error: '' })
    app.cloudCall('listUsers').then(res => {
      if (!res || !res.ok) {
        this.setData({
          loading: false,
          error: res && res.error === 'NOT_ADMIN' ? '只有管理员能管理用户' : '读取失败',
          isAdmin: !!(res && res.admin)
        })
        return
      }
      const list = (res.users || []).map(u => ({
        openid: u._id,
        shortId: u._id ? (u._id.slice(0, 8) + '…' + u._id.slice(-6)) : '',
        name: u.name || '',
        nickname: u.nickname || '',
        avatar: u.avatar || '',
        device: u.device || '',
        allowed: !!u.allowed,
        admin: !!u.admin,
        self: u._id === ((app.globalData.cloud && app.globalData.cloud.openid) || ''),
        createdAt: u.createdAt ? new Date(u.createdAt).toLocaleString() : '',
        lastSeen: u.lastSeen ? new Date(u.lastSeen).toLocaleString() : ''
      }))
      this.setData({ list, loading: false, isAdmin: true })
    }).catch(() => {
      this.setData({ loading: false, error: '调用失败，检查云函数是否已重新上传' })
    }).then(() => {
      // 首次启动时云函数冷启动可能超时无响应：还在转圈就再拉一次
      if (d < 2 && this.data.loading) {
        clearTimeout(this._retry)
        this._retry = setTimeout(() => this.load(d + 1), 1200)
      }
    })
  },

  // 管理员给设备起个名字（只改名字，不改变授权状态）
  rename(e) {
    const { openid, name, allowed } = e.currentTarget.dataset
    wx.showModal({
      title: '给这台设备起个名字',
      editable: true,
      content: name || '',
      placeholderText: '例如：张三 / 车间小李',
      success: r => {
        if (!r.confirm) return
        const nm = String(r.content || '').trim()
        if (!nm) {
          wx.showToast({ title: '名字不能为空', icon: 'none' })
          return
        }
        // allowed 必须原样带上：云端 setAllowed 收到 undefined 会当成 false，把待授权的设备给禁了
        app.cloudCall('setAllowed', {
          openid,
          allowed: allowed === 'true' || allowed === true,
          name: nm
        }).then(res => {
          if (!res || !res.ok) {
            wx.showToast({ title: '保存失败', icon: 'none' })
            return
          }
          wx.showToast({ title: '已改名', icon: 'success' })
          this.load()
        }).catch(() => wx.showToast({ title: '保存失败', icon: 'none' }))
      }
    })
  },

  toggle(e) {
    const { openid, allowed } = e.currentTarget.dataset
    const next = !(allowed === 'true' || allowed === true)
    wx.showLoading({ title: next ? '允许中' : '禁止中' })
    app.cloudCall('setAllowed', { openid, allowed: next }).then(res => {
      wx.hideLoading()
      if (!res || !res.ok) {
        wx.showToast({ title: '操作失败', icon: 'none' })
        return
      }
      wx.showToast({ title: next ? '已允许' : '已禁止', icon: 'success' })
      this.load()
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    })
  },

  setRole(e) {
    const { openid, role } = e.currentTarget.dataset
    const admin = role === 'admin'
    app.cloudCall('setAllowed', { openid, allowed: true, admin, role }).then(res => {
      if (!res || !res.ok) {
        wx.showToast({ title: res && res.error === 'CANNOT_DEMOTE_SELF' ? '不能改自己' : '操作失败', icon: 'none' })
        return
      }
      wx.showToast({ title: admin ? '已设为管理员' : '已设为工人', icon: 'success' })
      this.load()
    })
  },

  remove(e) {
    const openid = e.currentTarget.dataset.openid
    wx.showModal({
      title: '移除用户',
      content: '移除后这台设备将无法再同步，确定吗？',
      confirmColor: '#e94560',
      success: r => {
        if (!r.confirm) return
        app.cloudCall('removeUser', { openid }).then(res => {
          if (!res || !res.ok) {
            wx.showToast({ title: '移除失败', icon: 'none' })
            return
          }
          wx.showToast({ title: '已移除', icon: 'success' })
          this.load()
        })
      }
    })
  },

  copyId(e) {
    wx.setClipboardData({ data: e.currentTarget.dataset.openid })
  }
})
