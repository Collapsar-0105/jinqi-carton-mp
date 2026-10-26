const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const USERS = 'users'
const DATA = 'app_data'
const DOC = 'main'

const NEED_COLLS = ['orders', 'archive_orders', 'products', 'customers', 'suppliers', 'purchases', 'drafts']

// 云函数实例复用期间，集合创建只需要成功一次；此前每次调用都重试 9 次
// createCollection（每次点按钮都白搭 9 次数据库往返），是操作延迟的大头
let _ensured = false
// lastSeen 节流：同一实例内 60 秒只写一次，避免每次云调用都带一次 users 写操作
let _lastSeenAt = 0
let _lastSeenOpenid = ''

async function ensureColls(d) {
  for (const c of NEED_COLLS) {
    try { await d.createCollection(c) } catch (e) {}
  }
}

async function ensure() {
  for (const name of [USERS, DATA]) {
    try { await db.createCollection(name) } catch (e) {}
  }
}

async function getDoc(col, id) {
  try {
    const r = await db.collection(col).doc(id).get()
    return r.data || null
  } catch (e) {
    return null
  }
}

// 搜索辅助：转义正则、拼订单搜索文本
function escRe(s) {
  return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function orderSearchText(o) {
  return [
    o.id, o.customer, o.orderNo, o.urgent ? '加急' : '',
    (o.items || []).map(x => [x.productId, x.productName, x.po].filter(Boolean).join(' ')).join(' ')
  ].filter(Boolean).join(' ')
}
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }

  if (!_ensured) {
    await ensure()
    await ensureColls(db)
    _ensured = true
  }
  const action = event.action || 'pull'
  const payload = event.payload || {}

  let user = await getDoc(USERS, OPENID)

  if (!user) {
    const cnt = await db.collection(USERS).count()
    if (cnt.total === 0) {
      user = { _id: OPENID, allowed: true, admin: true, role: 'admin', name: '管理员', createdAt: Date.now(), lastSeen: Date.now() }
    } else {
      // 新用户先登记为待授权，管理员能看到并放行
      user = { _id: OPENID, allowed: false, admin: false, role: 'worker', name: '', createdAt: Date.now(), lastSeen: Date.now() }
    }
    try { await db.collection(USERS).add({ data: user }) } catch (e) {}
  } else {
    // lastSeen 60 秒节流：登录态还在用就行，不需要每次调用都精确到毫秒
    const now = Date.now()
    if (_lastSeenOpenid !== OPENID || now - _lastSeenAt > 60000) {
      _lastSeenOpenid = OPENID
      _lastSeenAt = now
      try { await db.collection(USERS).doc(OPENID).update({ data: { lastSeen: now } }) } catch (e) {}
    }
  }

  const admin = !!(user.admin && user.allowed)

  if (action === 'whoami') {
    return { ok: true, openid: OPENID, allowed: !!user.allowed, admin, user }
  }

  // 设置自己的称呼：放在 allowed 检查【之前】，
  // 这样刚扫码、还没被管理员放行的设备也能先把名字报上去，管理员才能认出该放行谁。
  if (action === 'setMyName') {
    const nm = String(payload.name || '').trim().slice(0, 20)
    const nick = String(payload.nickname || '').trim().slice(0, 20)
    const dev = String(payload.device || '').trim().slice(0, 40)
    const av = String(payload.avatar || '').trim().slice(0, 300)
    // 只有昵称/机型/称呼都有值时才写：客户端不上报称呼，
    // 这里绝不能用空值把管理员设的名字冲掉
    const patch = {}
    if (nm) patch.name = nm
    if (nick) patch.nickname = nick
    if (dev) patch.device = dev
    if (av) patch.avatar = av
    if (!Object.keys(patch).length) patch.name = nm
    try { await db.collection(USERS).doc(OPENID).update({ data: patch }) } catch (e) {}
    return { ok: true, name: nm, nickname: nick, device: dev, avatar: av }
  }

  if (action === 'listUsers') {
    if (!admin) return { ok: false, error: 'NOT_ADMIN' }
    const r = await db.collection(USERS).orderBy('createdAt', 'asc').limit(100).get()
    return { ok: true, openid: OPENID, admin, users: r.data || [] }
  }

  if (action === 'setAllowed') {
    if (!admin) return { ok: false, error: 'NOT_ADMIN' }
    const id = payload.openid
    if (!id) return { ok: false, error: 'NO_OPENID' }
    const patch = { allowed: !!payload.allowed }
    if (payload.name !== undefined) patch.name = payload.name
    if (payload.role !== undefined) patch.role = payload.role
    if (payload.admin !== undefined) {
      if (id === OPENID && !payload.admin) return { ok: false, error: 'CANNOT_DEMOTE_SELF' }
      patch.admin = !!payload.admin
      if (payload.admin) patch.allowed = true
    }
    await db.collection(USERS).doc(id).update({ data: patch })
    return { ok: true }
  }

  if (action === 'removeUser') {
    if (!admin) return { ok: false, error: 'NOT_ADMIN' }
    if (payload.openid === OPENID) return { ok: false, error: 'CANNOT_REMOVE_SELF' }
    await db.collection(USERS).doc(payload.openid).remove()
    return { ok: true }
  }

  if (action === 'clearData') {
    if (!admin) return { ok: false, error: 'NOT_ADMIN' }
    try { await db.collection(DATA).doc(DOC).remove() } catch (e) {}
    return { ok: true }
  }

  if (!user.allowed) {
    return { ok: false, error: 'NOT_ALLOWED', openid: OPENID, admin: false }
  }

  // ===== 订单：一单一文档 =====
  if (action === 'ordersList') {
    const year = payload.year || ''
    const page = Math.max(1, Number(payload.page) || 1)
    const size = Math.min(100, Number(payload.size) || 50)
    const keyword = String(payload.keyword || '').trim()
    const since = Number(payload.since) || 0
    const _ = db.command
    const terms = keyword ? keyword.split(/\s+/).filter(Boolean).slice(0, 6) : []

    // 多关键词：先按第一个词把范围缩到一年内，再在服务端用 JS 做多词 AND
    // （云数据库对同一字段不支持多次 where 条件，用 _.and 会匹配不到）
    if (terms.length > 1) {
      let q0 = db.collection('orders')
      const base = { search: db.RegExp({ regexp: escRe(terms[0]), options: 'i' }) }
      if (year) base.year = year
      if (since) base.updatedAt = _.gt(since)
      q0 = q0.where(base)
      const all = (await q0.limit(1000).get()).data || []
      const lower = terms.map(t => t.toLowerCase())
      const hits = all.filter(o => {
        const s = String(o.search || '').toLowerCase()
        return lower.every(t => s.indexOf(t) > -1)
      })
      hits.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
      return {
        ok: true,
        total: hits.length,
        page,
        size,
        list: hits.slice((page - 1) * size, page * size)
      }
    }

    let q = db.collection('orders')
    const conds = []
    if (year) conds.push({ year })
    if (since) conds.push({ updatedAt: _.gt(since) })
    if (terms.length === 1) {
      conds.push({ search: db.RegExp({ regexp: escRe(terms[0]), options: 'i' }) })
    }
    if (conds.length === 1) q = q.where(conds[0])
    else if (conds.length > 1) q = q.where(_.and(conds))
    const total = await q.count()
    const r = await q.orderBy('updatedAt', 'desc').skip((page - 1) * size).limit(size).get()
    let list = r.data || []
    let tot = total.total
    if (year && !list.length) {
      const ar = await db.collection('archive_orders').where({ year }).limit(size).get().catch(() => ({ data: [] }))
      list = (ar.data || []).map(x => Object.assign({}, x, { archived: true }))
      tot = list.length
    }
    return { ok: true, total: tot, page, size, list }
  }

  if (action === 'orderGet') {
    const d = await getDoc('orders', payload.id)
    return { ok: true, order: d }
  }

  if (action === 'orderSave') {
    const o = payload.order
    if (!o || !o.id) return { ok: false, error: 'NO_ID' }
    const doc = Object.assign({}, o, {
      id: o.id,
      year: (o.createdAt || '').slice(0, 4) || String(new Date().getFullYear()),
      search: orderSearchText(o),
      updatedAt: Date.now()
    })
    delete doc._id
    await db.collection('orders').doc(o.id).set({ data: doc })
    return { ok: true }
  }

  if (action === 'orderDelete') {
    try { await db.collection('orders').doc(payload.id).remove() } catch (e) {}
    try { await db.collection('archive_orders').doc(payload.id).remove() } catch (e) {}
    return { ok: true }
  }

  if (action === 'ordersYears') {
    // 翻页拉全：以前 limit(1000) 写死，订单破千后年份统计会漏
    const src = db.collection('orders').field({ year: true }).limit(1000)
    const years = {}
    let all = []
    let more = true
    while (more) {
      const r = await src.skip(all.length).get()
      all.push.apply(all, r.data || [])
      more = (r.data || []).length === 1000
    }
    ;(all || []).forEach(x => { if (x.year) years[x.year] = (years[x.year] || 0) + 1 })
    return { ok: true, years }
  }

  if (action === 'orderBulkSave') {
    const list = payload.orders || []
    let ok = 0
    for (const o of list) {
      if (!o || !o.id) continue
      const doc = Object.assign({}, o, {
        id: o.id,
        year: (o.createdAt || '').slice(0, 4) || String(new Date().getFullYear()),
        search: orderSearchText(o),
        updatedAt: Date.now()
      })
      try { const d2 = Object.assign({}, doc); delete d2._id; await db.collection('orders').doc(o.id).set({ data: d2 }); ok++ } catch (e) {}
    }
    return { ok: true, saved: ok, total: list.length }
  }

  if (action === 'ordersCounts') {
    const year = payload.year || ''
    const base = year ? db.collection('orders').where({ year }) : db.collection('orders')
    const count = async (extra) => {
      let q = base
      if (extra) q = q.where(extra)
      const r = await q.count()
      return r.total
    }
    const _ = db.command
    const all = await count(null)
    const active = await count({ status: _.in(['active', 'paused']) })
    const stocked = await count({ status: 'stocked' })
    const done = await count({ status: 'done' })
    const urgent = await count({ urgent: true })
    const paused = await count({ status: 'paused' })
    return { ok: true, all, active, stocked, done, urgent, paused }
  }

  const COLLS = ['products', 'customers', 'suppliers', 'purchases', 'drafts']
  if (action === 'collList') {
    if (COLLS.indexOf(payload.coll) < 0) return { ok: false, error: 'BAD_COLL' }
    const r = await db.collection(payload.coll).limit(1000).get()
    return { ok: true, list: r.data || [] }
  }
  if (action === 'collBulkSave') {
    if (COLLS.indexOf(payload.coll) < 0) return { ok: false, error: 'BAD_COLL' }
    const list = payload.list || []
    const col = db.collection(payload.coll)
    const old = await col.limit(1000).get().catch(() => ({ data: [] }))
    const keep = {}
    list.forEach(x => { if (x && x.id) keep[x.id] = true })
    for (const o of old.data || []) {
      if (!keep[o._id]) { try { await col.doc(o._id).remove() } catch (e) {} }
    }
    let n = 0
    for (const x of list) {
      if (!x || !x.id) continue
      try { await col.doc(x.id).set({ data: Object.assign({}, x, { updatedAt: Date.now() }) }); n++ } catch (e) {}
    }
    return { ok: true, saved: n }
  }

  if (action === 'archiveYear') {
    const year = String(payload.year || '')
    if (!year) return { ok: false, error: 'NO_YEAR' }
    const src = db.collection('orders').where({ year }).limit(1000)
    const all = []
    let more = true
    while (more) {
      const r = await src.skip(all.length).get()
      all.push.apply(all, r.data || [])
      more = (r.data || []).length === 1000
    }
    let moved = 0
    for (const o of all) {
      try {
        const copy = Object.assign({}, o)
        delete copy._id
        await db.collection('archive_orders').doc(o._id).set({ data: copy })
        await db.collection('orders').doc(o._id).remove()
        moved++
      } catch (e) {}
    }
    return { ok: true, moved, year }
  }

  if (action === 'clearTest') {
    const adminUser = await getDoc('users', OPENID)
    if (!adminUser || !adminUser.admin) return { ok: false, error: 'NOT_ADMIN' }
    const r1 = await db.collection('orders').where({ id: db.RegExp({ regexp: '^PT', options: '' }) }).remove().catch(() => ({ stats: {} }))
    return { ok: true, removed: (r1 && r1.stats && r1.stats.removed) || 0 }
  }

  if (action === 'pull') {
    const d = await getDoc(DATA, DOC)
    return {
      ok: true,
      openid: OPENID,
      admin,
      role: user.role || (user.admin ? 'admin' : 'worker'),
      payload: d ? d.payload : null,
      updatedAt: d ? d.updatedAt : 0,
      updatedBy: d ? d.updatedBy : ''
    }
  }

  if (action === 'push') {
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'BAD_PAYLOAD' }
    // 冲突检测：客户端告诉我它基于哪个版本改的，云端更新过就让它先合并
    const baseAt = Number(payload._baseAt) || 0
    try { delete payload._baseAt } catch (e) {}
    const cur = await getDoc(DATA, DOC)
    const curAt = cur ? (Number(cur.updatedAt) || 0) : 0
    if (curAt && baseAt && curAt > baseAt) {
      return { ok: false, error: 'CONFLICT', payload: cur.payload || null, updatedAt: curAt, updatedBy: cur.updatedBy || '' }
    }
    const updatedAt = Date.now()
    const doc = { payload, updatedAt, updatedBy: OPENID }
    try {
      await db.collection(DATA).doc(DOC).set({ data: doc })
    } catch (e) {
      await db.collection(DATA).add({ data: Object.assign({ _id: DOC }, doc) })
    }
    return { ok: true, updatedAt }
  }

  return { ok: false, error: 'UNKNOWN_ACTION' }
}
