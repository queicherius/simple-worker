import redis from 'redis'
import async from 'async'
import _sum from 'sum-by'
let prefix = 'sw:monit:'
let client

export function setup (redisOptions) {
  client = redis.createClient(redisOptions)
}

export function queue (name) {
  // Add the name of the job to the set of jobs
  client.sadd(`${prefix}joblist`, name)

  // Increase the number of queued jobs
  client.hincrby(`${prefix}job:${name}`, 'queued', 1)
}

export function process (name, attempts) {
  // Decrease the number of queued jobs, if this is the first try
  if (isNaN(attempts)) {
    client.hincrby(`${prefix}job:${name}`, 'queued', -1)
  }

  // Increase the number of active jobs
  client.hincrby(`${prefix}job:${name}`, 'active', 1)
}

export function finish (name, error, processingTime) {
  // Decrease the number of active jobs
  client.hincrby(`${prefix}job:${name}`, 'active', -1)

  // Increase the number of jobs that finished with this status
  let status = finishStatus(error)
  client.hincrby(`${prefix}job:${name}`, status, 1)

  // Push the processing time, status and timestamp into the history
  const timeData = [processingTime, status, new Date().getTime()]
  client.lpush(`${prefix}job:history:${name}`, JSON.stringify(timeData))
  client.ltrim(`${prefix}job:history:${name}`, 0, 999)
}

function finishStatus (error) {
  if (!error) {
    return 'completed'
  }

  if (error === 'TTL exceeded') {
    return 'timeout'
  }

  return 'failed'
}

export function getData () {
  return new Promise((resolve, reject) => {
    // Get all the known job names
    client.smembers(`${prefix}joblist`, (err, names) => {
      if (err) return reject(err)

      // For each job name, get the stats
      const lookups = names.map(name => (cb) => getJobData(name, cb))
      async.parallel(lookups, (err, values) => {
        if (err) return reject(err)
        resolve(values)
      })
    })
  })
}

const baseStats = {queued: 0, active: 0, completed: 0, timeout: 0, failed: 0}

function getJobData (name, callback) {
  // Get the job stats (queued, active, failed, etc)
  client.hgetall(`${prefix}job:${name}`, (err, stats) => {
    if (err) return callback(err)

    // Get the job history
    client.lrange(`${prefix}job:history:${name}`, 0, -1, (err, history) => {
      if (err) return callback(err)

      // Parse the stats into numbers and merge with the base stats
      Object.keys(stats).map(key => {
        stats[key] = parseInt(stats[key], 10)
      })
      stats = {...baseStats, ...stats}
      stats.total = _sum(Object.values(stats))

      // Parse the history
      history = history.map(JSON.parse)

      // Give back the data for the job
      callback(null, {name, stats, history})
    })
  })
}
