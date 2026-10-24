const cloudApi = require('./cloud.js')

function list(coll) {
  return cloudApi.call('collList', { coll })
}

function bulkSave(coll, list) {
  return cloudApi.call('collBulkSave', { coll, list })
}

module.exports = { list, bulkSave }
