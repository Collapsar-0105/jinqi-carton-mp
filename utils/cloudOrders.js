// 订单云端读写（一单一文档）
const cloudApi = require('./cloud.js')

const cache = { list: [], byId: {}, at: 0 }

function list(opts) {
  const payload = {
    year: (opts && opts.year) || '',
    page: (opts && opts.page) || 1,
    size: (opts && opts.size) || 50,
    keyword: (opts && opts.keyword) || ''
  }
  return cloudApi.call('ordersList', payload).then(res => {
    if (res && res.ok) {
      cache.list = res.list || []
      cache.at = Date.now()
      ;(res.list || []).forEach(o => { cache.byId[o._id] = o })
    }
    return res
  })
}

function get(id) {
  if (cache.byId[id]) return Promise.resolve({ ok: true, order: cache.byId[id], cached: true })
  return cloudApi.call('orderGet', { id }).then(res => {
    if (res && res.ok && res.order) cache.byId[id] = res.order
    return res
  })
}

function save(order) {
  cache.byId[order.id] = order
  return cloudApi.call('orderSave', { order })
}

function remove(id) {
  delete cache.byId[id]
  cache.list = cache.list.filter(o => o._id !== id && o.id !== id)
  return cloudApi.call('orderDelete', { id })
}

function migrate(orders) {
  const all = orders || []
  const chunks = []
  for (let i = 0; i < all.length; i += 40) chunks.push(all.slice(i, i + 40))
  let saved = 0
  return chunks.reduce((p, c) => p.then(() => cloudApi.call('orderBulkSave', { orders: c }).then(r => {
    saved += (r && r.saved) || 0
  })), Promise.resolve()).then(() => {
    cache.list = []
    cache.byId = {}
    return { ok: true, saved, total: all.length }
  })
}

function archive(year) {
  return cloudApi.call('archiveYear', { year })
}

function years() {
  return cloudApi.call('ordersYears')
}

module.exports = { list, get, save, remove, migrate, archive, years, cache }
