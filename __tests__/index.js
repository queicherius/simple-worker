const uuid = require('uuid')
const SimpleWorker = require('../src/index')

function filterLogData (data) {
  if (data && data.duration) {
    data.duration = 9001
  }

  if (data && data.data && data.data.errorStack) {
    data.data.errorStack = 'Somewhere over the rainbows'
  }

  return data
}

const makeTestQueue = (jobs) => {
  let logs = []

  const queue = new SimpleWorker({
    name: uuid(),
    redis: {
      host: '127.0.0.1',
      port: 6379
    },
    jobs: jobs,
    logger: {
      info: (message, data) => logs.push({type: 'info', message, data: filterLogData(data)}),
      warn: (message, data) => logs.push({type: 'warn', message, data: filterLogData(data)}),
      error: (message, data) => logs.push({type: 'error', message, data: filterLogData(data)})
    }
  })

  queue._logs = logs

  return queue
}

async function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('SimpleWorker', () => {
  test('has PRIORITIES', () => {
    expect(Object.keys(SimpleWorker.PRIORITIES)).toEqual(['HIGH', 'MEDIUM', 'LOW'])
  })

  test('can create a new queue instance', () => {
    const queue = makeTestQueue([])
    expect(queue.add).not.toBe(undefined)
    expect(queue._logs).toEqual([])
  })

  it('can queue and subsequently process a job', async () => {
    // Create a job to test if logging and passing in data is working
    let jobWasProcessed = false
    const jobFunction = async (job) => {
      job.info('Starting job function')
      await sleep(1000)
      jobWasProcessed = job.data.input
      job.warn('Finished job function')
    }

    // Create the queue with the job options
    const queue = makeTestQueue([{
      name: 'testing-processing',
      handler: jobFunction,
      options: {
        priority: SimpleWorker.PRIORITIES.HIGH,
        timeout: 10000
      }
    }])

    // Add the job to the queue
    queue.add('testing-processing', {input: '123'})

    // Check if the job is in the queue
    await sleep(250)
    expect((await queue.list()).map(job => job.data)).toMatchSnapshot()

    // Start processing and check if it is in the list still
    queue.process()
    await sleep(250)
    expect((await queue.list()).map(job => job.data)).toMatchSnapshot()
    expect(queue._logs).toMatchSnapshot()

    // Wait until the job should be done
    await sleep(1000)
    expect((await queue.list()).map(job => job.data)).toEqual([])
    expect(queue._logs).toMatchSnapshot()
    expect(jobWasProcessed).toEqual('123')
  })

  it('logs errors in the queue', () => {
    const queue = makeTestQueue([])
    const error = new Error('Oh no.')
    queue._queue.emit('error', error, 'error running queue')
    expect(queue._logs.map(filterLogData)).toMatchSnapshot()
  })
})
