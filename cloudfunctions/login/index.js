const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  const { OPENID, APPID } = cloud.getWXContext()
  return { ok: true, openid: OPENID, appid: APPID }
}
