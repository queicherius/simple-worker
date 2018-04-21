const Queue = require('bull')
const scheduler = require('node-schedule')
const cronstring = require('cronstring')

class SimpleWorker {
  constructor (options) {
    this.name = options.name
    this.connection = options.redis
    this.jobConfiguration = toMap(options.jobs, 'name')
    this.logger = options.logger

    this._queue = new Queue(this.name, this.connection)

    this._queue.on('error', (error) => {
      this.logger.error('Queue error', {
        errorMessage: error.message,
        errorStack: error.stack
      })
    })

    this._queue.on('stalled', (job) => {
      const {jobName, jobData} = splitJobData(job.data)
      this.logger.warn('Job processing stalled', {
        jobId: job.id,
        attempt: job.attemptsMade,
        name: jobName,
        data: jobData
      })
    })
  }

  add (name, data) {
    const configuration = this.jobConfiguration[name]

    if (!configuration) {
      this.logger.error(`Job configuration not found`, {name: name})
      throw new Error(`Job configuration not found`)
    }

    const jobData = Object.assign(data || {}, {handler: name})
    // TODO merge defaults or throw on missing
    const jobOptions = Object.assign(configuration.options || {}, {
      removeOnComplete: true,
      removeOnFail: true
    })

    this.logger.info('Adding new job to the queue', {name, data})
    return this._queue.add('job', jobData, jobOptions)
  }

  schedule () {
    const scheduable = Object.values(this.jobConfiguration).filter(job => job.scheduling)
    this.logger.info(`Scheduling ${scheduable.length} repeatable jobs`)

    scheduable.forEach(job => {
      const schedule = cronstring(job.scheduling) ? cronstring(job.scheduling) : job.scheduling
      this.logger.info(`Scheduling ${job.name} with schedule "${schedule}"`)

      scheduler.scheduleJob(schedule, () => {
        this.add(job.name)
      })
    })
  }

  process () {
    this.logger.info(`Starting job processing`)

    this._queue.process('job', 1, async (job, done) => {
      const {jobName, jobData} = splitJobData(job.data)
      const configuration = this.jobConfiguration[jobName]

      if (!configuration) {
        return this.logger.error(`Job configuration not found`, {name: jobName})
      }

      this.logger.info('Job processing started', {
        jobId: job.id,
        attempt: job.attemptsMade,
        name: jobName,
        data: jobData
      })

      // Add a function so that jobs can log into the same logger
      const sendLogMessage = (type, message, data) => {
        this.logger[type](message, {
          jobId: job.id,
          attempt: job.attemptsMade,
          name: jobName,
          data: jobData,
          messageData: data
        })
      }
      job.info = (message, data) => sendLogMessage('info', message, data)
      job.warn = (message, data) => sendLogMessage('warn', message, data)
      job.error = (message, data) => sendLogMessage('error', message, data)

      // Add a function so that jobs can queue additional jobs
      job.add = (name, data) => this.add(name, data)

      // Setup start date for job duration calculation
      const start = new Date()

      // Execute the handler
      try {
        const result = await promiseTimeout(configuration.handler(job), job.opts.timeout)

        this.logger.info('Job processing completed', {
          jobId: job.id,
          attempt: job.attemptsMade,
          name: jobName,
          data: jobData,
          duration: new Date() - start,
          result
        })

        done(result)
      } catch (error) {
        this.logger.error('Job processing failed', {
          jobId: job.id,
          attempt: job.attemptsMade,
          name: jobName,
          data: jobData,
          duration: new Date() - start,
          errorMessage: error.message,
          errorStack: error.stack
        })

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

  return {jobName, jobData}
}

function promiseTimeout (promise, ms) {
  if (!ms) {
    return promise
  }

  let timeoutId
  let timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Job processing timed out after ${ms} ms`))
    }, ms)
  })

  return Promise.race([
    promise,
    timeout
  ]).then((result) => {
    clearTimeout(timeoutId)
    return result
  })
}

function validateJobConfiguration () {
  // TODO
}

module.exports = SimpleWorker
