// 云函数调用封装
function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise(resolve => setTimeout(() => resolve({ ok: false, error: 'TIMEOUT' }), ms))
  ])
}

function call(action, payload) {
  return withTimeout(new Promise((resolve, reject) => {
    if (!wx.cloud) return reject(new Error('NO_CLOUD'))
    wx.cloud.callFunction({
      name: 'data',
      data: { action, payload: payload || {} },
      success: res => resolve(res.result || {}),
      fail: err => reject(err)
    })
  }), 6000)
}

module.exports = { call }
