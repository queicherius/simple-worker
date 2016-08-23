import kue from 'kue'
import schedule from 'node-schedule'
import basicAuth from 'basic-auth-connect'
import express from 'express'
const debug = require('debug')('simple-worker')

// Default options of a job
const defaultJobOptions = {
  data: {},
  priority: 'medium',
  attempts: 1,
  backoff: {delay: 30 * 1000, type: 'exponential'},
  ttl: 60 * 60 * 1000,
  callback: () => false,
  delay: false,
  schedule: false
}

// The registered job handlers
let jobHandlers = {}

// The created queue
let queue

// Create the internal queue using kue
export const setup = (options) => {
  debug('setting up')
  queue = kue.createQueue(options)

  // Handle stuck jobs in redis, because the operations are not atomic
  // See https://github.com/Automattic/kue#unstable-redis-connections
  queue.watchStuckJobs(5 * 1000)

  // Log uncaught errors
  queue.on('error', (err) => console.error('Uncaught error in simple-worker', err))
  return queue
}

// Start the web interface
export const webInterface = (port, username, password) => {
  const server = express()
  kue.app.set('title', 'Simple worker')

  if (username && password) {
    server.use(basicAuth(username, password))
  }

  server.use(kue.app)
  server.listen(port)
}

// Register a job handler
export const registerJob = (name, callback) => {
  debug(`registering job: ${name}`)
  jobHandlers[name] = callback
}

// Start the processing of jobs
export const processJobs = () => {
  debug('starting processing of jobs')

  queue.process('simple-worker', (job, done) => {
    debug('processing job: ' + job.data.handler)

    // Grab the actual job handler
    const callback = jobHandlers[job.data.handler]

    // Overwrite the done function with some logging
    const customDone = (err, data) => {
      debug('job finished processing: ' + job.data.handler)
      done(err, data)
    }

    // Execute the job and catch all possible errors (promise / synchronous)
    try {
      const jobPromise = callback(job, customDone)
      if (jobPromise !== undefined && typeof jobPromise.catch === 'function') {
        jobPromise.catch(err => customDone(err, null))
      }
    } catch (err) {
      customDone(err, null)
    }
  })
}

// Queue a job for processing or schedule a job
export const queueJob = (options) => {
  if (!options.name || !options.title) {
    throw new Error("A 'name' and a 'title' have to be provided")
  }

  if (!options.schedule) {
    return _queueJob(options)
  }

  debug(`job scheduled: ${options.name} (${options.schedule})`)
  schedule.scheduleJob(options.schedule, () => _queueJob(options))
}

// Queue a job for processing
const _queueJob = (options) => {
  // Build the data
  options = {...defaultJobOptions, ...options}
  const data = {...options.data, title: options.title, handler: options.name}

  // Create the job
  const job = queue.create('simple-worker', data)
    .priority(options.priority)
    .attempts(options.attempts)
    .backoff(options.backoff)
    .ttl(options.ttl)
    .delay(options.delay)

  // Attach callbacks
  job.on('complete', (result) => options.callback(null, result))
  job.on('failed', (err) => options.callback(err, null))

  // Save for processing later
  job.save((err) => {
    if (err) {
      return debug('Failed queuing job', options)
    }

    debug(`queued job for processing: ${options.name}`)
  })
}
