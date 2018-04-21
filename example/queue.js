const SimpleWorker = require('../src/index')
const configuration = require('./jobConfiguration')

const queue = new SimpleWorker({
  name: 'bgjobs',
  redis: {
    host: '127.0.0.1',
    port: 6379
  },
  jobs: configuration,
  logger: {
    info: (message, data) => console.log(`[INFO] ${message}`, data),
    warn: (message, data) => console.log(`[WARN] ${message}`, data),
    error: (message, data) => console.log(`[ERROR] ${message}`, data)
  }
})

module.exports = queue
