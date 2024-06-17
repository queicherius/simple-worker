const BullQueue = require('bull')
const scheduler = require('node-schedule')
const cronstring = require('cronstring')

class SimpleWorker {
  constructor (options) {
    // Validate the setup options
    if (
      !options.name || !options.redis || !options.jobs || !options.logger ||
      !options.logger.info || !options.logger.warn || !options.logger.error
    ) {
      throw new Error('The queue options are not valid.' +
        'Please supply `name`, `redis`, `jobs`, `logger.info`, `logger.warn` & `logger.error`')
    }
    options.jobs.forEach(validateJobConfiguration)

    // Setup the internal values
    this.name = options.name
    this.connection = options.redis
    this.jobConfiguration = toMap(options.jobs, 'name')
    this.logger = options.logger

    this.connect()
  }

  connect () {
    this._queue = new BullQueue(this.name, this.connection)
    this.logger.info('job_queue_connection_ready')

    // Setup queue listeners
    this._queue.on('error', (error) => {
      this.logger.error('job_queue_connection_error', {
        error_message: error.message,
        error_stack: error.stack
      })
    })

    this._queue.on('stalled', (job) => {
      const { jobName, jobData } = splitJobData(job.data)
      this.logger.warn('job_stalled', {
        job_id: job.id,
        attempt: job.attemptsMade,
        name: jobName,
        data: jobData
      })
    })
  }

  add (name, data) {
    const configuration = this.jobConfiguration[name]

    if (!configuration) {
      this.logger.error('job_errored', { name, error_message: 'Job configuration not found' })
      throw new Error(`Job configuration not found`)
    }

    const jobData = Object.assign({}, data || {}, { handler: name })
    const jobOptions = Object.assign(
      { priority: SimpleWorker.PRIORITIES.MEDIUM },
      configuration.options || {},
      { removeOnComplete: true, removeOnFail: true }
    )

    this.logger.info('job_queued', { name, data })
    return this._queue.add('job', jobData, jobOptions)
  }

  schedule () {
    const schedulable = Object.values(this.jobConfiguration).filter(job => job.scheduling)

    schedulable.forEach(job => {
      const schedule = cronstring(job.scheduling) ? cronstring(job.scheduling) : job.scheduling
      this.logger.info('job_scheduled', { name: job.name, schedule })
      scheduler.scheduleJob(schedule, () => this.add(job.name))
    })
  }

  process () {
    this.logger.info('job_processing_ready')

    this._queue.process('job', 1, async (job, done) => {
      const { jobName, jobData } = splitJobData(job.data)
      const configuration = this.jobConfiguration[jobName]

      if (!configuration) {
        return this.logger.error('job_errored', { name: jobName, error_message: 'Job configuration not found' })
      }

      this.logger.info('job_started', {
        job_id: job.id,
        attempt: job.attemptsMade,
        name: jobName,
        data: jobData
      })

      // Add a function so that jobs can log into the same logger
      const loggerWrapper = (level, kind, values) => {
        this.logger[level](kind, {
          job_id: job.id,
          attempt: job.attemptsMade,
          name: jobName,
          data: jobData,
          ...values
        })
      }
      job.info = (kind, values) => loggerWrapper('info', kind, values)
      job.warn = (kind, values) => loggerWrapper('warn', kind, values)
      job.error = (kind, values) => loggerWrapper('error', kind, values)

      // Add a function so that jobs can queue and list jobs
      job.add = (name, data) => this.add(name, data)
      job.list = () => this.list()

      // Setup start date for job duration calculation
      const start = new Date()

      // Execute the handler
      try {
        const result = await promiseTimeout(configuration.handler(job), job.opts.timeout)

        this.logger.info('job_processed', {
          job_id: job.id,
          attempt: job.attemptsMade,
          name: jobName,
          data: jobData,
          duration: new Date() - start,
          result
        })

        done(result)
      } catch (error) {
        if (error instanceof PromiseTimeoutError) {
          this.logger.error('job_timeout', {
            job_id: job.id,
            attempt: job.attemptsMade,
            name: jobName,
            data: jobData,
            duration: new Date() - start
          })
        } else {
          this.logger.error('job_errored', {
            job_id: job.id,
            attempt: job.attemptsMade,
            name: jobName,
            data: jobData,
            duration: new Date() - start,
            error_message: error.message,
            error_stack: error.stack
          })
        }

        done(null, error)
      }
    })
  }

  async list () {
    const jobs = await Promise.all([
      this._queue.getActive(),
      this._queue.getWaiting()
    ])

    return jobs.reduce((arr, x) => arr.concat(x), [])
  }

  pause () {
    return this._queue.pause()
  }

  resume () {
    return this._queue.resume()
  }

  flush () {
    return this._queue.empty()
  }
}

SimpleWorker.PRIORITIES = {
  HIGH: 5,
  MEDIUM: 10,
  LOW: 20
}

function toMap (array, key) {
  let map = {}

  array.forEach(entry => {
    map[entry[key]] = entry
  })

  return map
}

function splitJobData (data) {
  const jobName = data.handler
  const jobData = Object.assign({}, data)
  delete jobData.handler

  return { jobName, jobData }
}

async function promiseTimeout (promise, timeoutMs) {
  if (!timeoutMs) return promise

  let timeoutId
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new PromiseTimeoutError()), timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).then((result) => {
    clearTimeout(timeoutId)
    return result
  })
}

class PromiseTimeoutError extends Error {
  constructor () {
    super('Promise timed out')
  }
}

function validateJobConfiguration (job) {
  if (!job.name) {
    throw new Error('The job needs a unique name')
  }

  if (!job.handler) {
    throw new Error(`The job ${job.name} needs a handler function`)
  }
}

module.exports = SimpleWorker
