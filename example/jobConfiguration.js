const { PRIORITIES } = require('../src/index')
const sendEmail = require('./jobs/sendEmail')
const hackerman = require('./jobs/hackerman')

const configuration = [
  {
    name: 'send-email',
    handler: sendEmail,
    options: {
      priority: PRIORITIES.MEDIUM,
      timeout: 5 * 60 * 1000
    },
    scheduling: 'every minute'
  },
  {
    name: 'hackerman',
    handler: hackerman,
    options: {
      priority: PRIORITIES.HIGH,
      timeout: 1000
    }
  }
]

module.exports = configuration
