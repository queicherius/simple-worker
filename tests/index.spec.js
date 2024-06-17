/* eslint-env jest */
const uuid = require('uuid')
const SimpleWorker = require('../src/index')

const makeTestQueue = (jobs) => {
  const logs = []

  function pushLog (level, kind, values) {
    if (values) {
      if (typeof values.job_duration !== 'undefined') {
        values.job_duration = 9001
      }

      if (values.error_stack) {
        values.error_stack = values.error_stack.split('\n')[0]
      }

      if (typeof values.job_data === 'undefined') {
        delete values.job_data
      }
    }

    logs.push({ _level: level, _kind: kind, ...values })
  }

  const queue = new SimpleWorker({
    name: uuid(),
    redis: {
      host: '127.0.0.1',
      port: 6379
    },
    jobs: jobs,
    logger: {
      info: (kind, values) => pushLog('info', kind, values),
      warn: (kind, values) => pushLog('warn', kind, values),
      error: (kind, values) => pushLog('error', kind, values)
    }
  })

  queue._logs = logs

  return queue
}

async function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('SimpleWorker', () => {
  it('has PRIORITIES', () => {
    expect(Object.keys(SimpleWorker.PRIORITIES)).toEqual(['HIGH', 'MEDIUM', 'LOW'])
  })

  it('can create a new queue instance', () => {
    const queue = makeTestQueue([])
    expect(queue.add).not.toBe(undefined)
    expect(queue._logs).toMatchSnapshot()
  })

  it('can queue and subsequently process a job', async () => {
    // Create a job to test if logging and passing in data is working
    let jobWasProcessed = false
    const jobFunction = async (job) => {
      job.info('job_function_log_info')
      await sleep(500)
      job.warn('job_function_log_warn', { foo: 'bar' })
      jobWasProcessed = job.data.input
      job.error('job_function_log_error')
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
    queue.add('testing-processing', { input: '123' })

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

  it('can schedule jobs', async () => {
    // Create a job
    let jobWasProcessed = 0
    const jobFunction = async () => {
      jobWasProcessed++
    }

    // Create the queue with the job options
    const queue = makeTestQueue([
      {
        name: 'testing-processing',
        handler: jobFunction,
        options: {
          priority: SimpleWorker.PRIORITIES.HIGH,
          timeout: 10000
        },
        scheduling: '* * * * * *' // every second
      },
      {
        name: 'testing-processing-2',
        handler: jobFunction,
        options: {
          priority: SimpleWorker.PRIORITIES.HIGH,
          timeout: 10000
        },
        scheduling: 'every day'
      },
      {
        name: 'testing-processing-3',
        handler: jobFunction,
        options: {
          priority: SimpleWorker.PRIORITIES.HIGH,
          timeout: 10000
        }
      }
    ])

    // Start the queue scheduler
    expect((await queue.list()).map(job => job.data)).toEqual([])
    queue.schedule()

    // Expect that the job got queued at least 2 times
    await sleep(3000)
    expect((await queue.list())[0].data).toMatchSnapshot()
    expect((await queue.list()).length).toBeGreaterThan(2)
    expect(jobWasProcessed).toBe(0)
  })

  it('can pause and resume the processing', async () => {
    let jobWasProcessed = false
    const jobFunction = async () => {
      jobWasProcessed = true
    }

    // Create the queue with the job options
    const queue = makeTestQueue([{
      name: 'testing-processing',
      handler: jobFunction
    }])

    // Start processing and then directly pause
    queue.process()
    await sleep(250)
    queue.pause()
    await sleep(250)

    // Add the job to the queue
    queue.add('testing-processing')

    // Check if the job is still in the queue (aka processing is paused)
    await sleep(500)
    expect((await queue.list()).map(job => job.data)).toMatchSnapshot()
    expect(jobWasProcessed).toEqual(false)

    // Resume and wait until the job should be done
    queue.resume()
    await sleep(500)
    expect((await queue.list()).map(job => job.data)).toEqual([])
    expect(queue._logs).toMatchSnapshot()
    expect(jobWasProcessed).toEqual(true)
  })

  it('can flush the queue', async () => {
    // Create the queue with the job options
    const queue = makeTestQueue([{
      name: 'testing-processing',
      handler: () => false,
      options: {
        priority: SimpleWorker.PRIORITIES.HIGH,
        timeout: 10000
      }
    }])

    // Add the jobs to the queue
    queue.add('testing-processing', { input: '123' })
    queue.add('testing-processing', { input: '456' })
    queue.add('testing-processing', { input: '789' })

    // Check if the jobs are in the queue
    await sleep(250)
    expect((await queue.list()).map(job => job.data)).toMatchSnapshot()

    // Flush the queue
    await queue.flush()

    // Expect that the jobs are gone
    await sleep(250)
    expect((await queue.list()).map(job => job.data)).toEqual([])
  })

  it('can timeout a long running job', async () => {
    const jobFunction = async () => {
      await sleep(10000)
    }

    // Create the queue with the job options
    const queue = makeTestQueue([{
      name: 'testing-processing',
      handler: jobFunction,
      options: {
        priority: SimpleWorker.PRIORITIES.HIGH,
        timeout: 1000
      }
    }])

    // Add the job to the queue and start processing
    queue.add('testing-processing')
    queue.process()

    // Wait until the job should be done
    await sleep(2000)
    expect((await queue.list()).map(job => job.data)).toEqual([])
    expect(queue._logs).toMatchSnapshot()
  })

  it('can handle an error in the job function (async)', async () => {
    // Create a job to test if error handling is working
    const jobFunction = async () => {
      throw new Error('The CPU is on fire.')
    }

    // Create the queue with the job options
    const queue = makeTestQueue([{
      name: 'testing-errors',
      handler: jobFunction,
      options: {
        priority: SimpleWorker.PRIORITIES.HIGH,
        timeout: 10000
      }
    }])

    // Add the job to the queue and process it
    queue.add('testing-errors')
    await sleep(250)
    queue.process()
    await sleep(250)

    // Expect that the job got removed from the queue and the logs include the error
    expect((await queue.list()).map(job => job.data)).toEqual([])
    expect(queue._logs).toMatchSnapshot()
  })

  it('can handle an error in the job function (sync)', async () => {
    // Create a job to test if error handling is working
    const jobFunction = () => {
      throw new Error('The CPU is on fire.')
    }

    // Create the queue with the job options
    const queue = makeTestQueue([{
      name: 'testing-errors',
      handler: jobFunction,
      options: {
        priority: SimpleWorker.PRIORITIES.HIGH,
        timeout: 10000
      }
    }])

    // Add the job to the queue and process it
    queue.add('testing-errors')
    await sleep(250)
    queue.process()
    await sleep(250)

    // Expect that the job got removed from the queue and the logs include the error
    expect((await queue.list()).map(job => job.data)).toEqual([])
    expect(queue._logs).toMatchSnapshot()
  })

  it('can add and list jobs from within a job function', async () => {
    let listInJob = []
    const jobFunction = async (job) => {
      await job.add('testing-processing-2')
      listInJob = (await job.list()).map(job => job.data)
      await sleep(2000)
    }

    // Create the queue with the job options
    const queue = makeTestQueue([
      {
        name: 'testing-processing',
        handler: jobFunction
      },
      {
        name: 'testing-processing-2',
        handler: () => false
      }
    ])

    // Add the job to the queue
    queue.add('testing-processing')

    // Start processing and then check if the new job is in the list
    queue.process()
    await sleep(500)
    expect(listInJob).toMatchSnapshot()
    expect((await queue.list()).map(job => job.data)).toMatchSnapshot()
    expect(queue._logs).toMatchSnapshot()
  })

  it('logs internal errors in the queue', () => {
    const queue = makeTestQueue([])
    const error = new Error('Oh no.')
    queue._queue.emit('error', error, 'error running queue')
    expect(queue._logs).toMatchSnapshot()
  })

  it('logs stalled jobs in the queue', () => {
    const queue = makeTestQueue([])
    const job = {
      id: 333,
      attemptsMade: 1,
      data: {
        handler: 'test-handler',
        email: 'pepe@me.me'
      }
    }

    queue._queue.emit('stalled', job)
    expect(queue._logs).toMatchSnapshot()
  })

  it('errors when the options are missing during setup', () => {
    expect(() => new SimpleWorker()).toThrow()
  })

  it('errors when the name is invalid during setup', () => {
    expect(() => new SimpleWorker({ name: '' })).toThrow()
  })

  it('errors when the redis connection is invalid during setup', () => {
    expect(() => new SimpleWorker({ name: 'test-1' })).toThrow()
  })

  it('errors when the job configuration is invalid during setup', () => {
    expect(() =>
      new SimpleWorker({
        name: 'test-1',
        redis: {
          host: '127.0.0.1',
          port: 6379
        }
      })
    ).toThrow()

    expect(() =>
      new SimpleWorker({
        name: 'test-1',
        redis: {
          host: '127.0.0.1',
          port: 6379
        },
        jobs: [
          { hi: 'there' }
        ],
        logger: { info: () => false, warn: () => false, error: () => false }
      })
    ).toThrow()

    expect(() =>
      new SimpleWorker({
        name: 'test-1',
        redis: {
          host: '127.0.0.1',
          port: 6379
        },
        jobs: [
          { name: 'there' }
        ],
        logger: { info: () => false, warn: () => false, error: () => false }
      })
    ).toThrow()
  })

  it('errors when the logger is invalid during setup', () => {
    expect(() =>
      new SimpleWorker({
        name: 'test-1',
        redis: {
          host: '127.0.0.1',
          port: 6379
        },
        jobs: []
      })
    ).toThrow()

    expect(() =>
      new SimpleWorker({
        name: 'test-1',
        redis: {
          host: '127.0.0.1',
          port: 6379
        },
        jobs: [],
        logger: {
          info: () => false,
          what: () => false
        }
      })
    ).toThrow()
  })

  it('errors when the job configuration is missing while adding', () => {
    const queue = makeTestQueue([])
    expect(() => queue.add('not-existing')).toThrow()
    expect(queue._logs).toMatchSnapshot()
  })

  it('errors when the job configuration is missing while processing', async () => {
    const queue = makeTestQueue([{
      name: 'not-existing',
      handler: () => false
    }])
    queue.add('not-existing')

    // Overwrite internals to simulate missing processing handler
    queue.jobConfiguration = []
    queue.process()
    await sleep(250)

    expect(queue._logs).toMatchSnapshot()
  })
})
