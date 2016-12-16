import redis from 'redis'
import async from 'async'
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

export function process (name) {
  // Decrease the number of queued jobs
  client.hincrby(`${prefix}job:${name}`, 'queued', -1)

  // Increase the number of active jobs
  client.hincrby(`${prefix}job:${name}`, 'active', 1)
}

export function finish (name, error, processingTime) {
  // Decrease the number of active jobs
  client.hincrby(`${prefix}job:${name}`, 'active', -1)

  // Increase the number of completed, timed out or failed jobs
  // based on if there was an error or not
  if (!error) {
    client.hincrby(`${prefix}job:${name}`, 'completed', 1)
  } else if (error === 'TTL exceeded') {
    client.hincrby(`${prefix}job:${name}`, 'timeout', 1)
  } else {
    client.hincrby(`${prefix}job:${name}`, 'failed', 1)
  }

  // Push the processing time into the history
  const timeData = [processingTime, new Date().getTime()]
  client.lpush(`${prefix}job:times:${name}`, JSON.stringify(timeData))
  client.ltrim(`${prefix}job:times:${name}`, 0, 999)
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

function getJobData (name, callback) {
  // Get the job stats (queued, active, failed, etc)
  client.hgetall(`${prefix}job:${name}`, (err, stats) => {
    if (err) return callback(err)

    // Get the last job times
    client.lrange(`${prefix}job:times:${name}`, 0, -1, (err, times) => {
      if (err) return callback(err)

      // Parse data propperly
      Object.keys(stats).map(key => {
        stats[key] = parseInt(stats[key], 10)
      })
      times = times.map(JSON.parse)

      // Give back the data for the job
      callback(null, {name, stats, times})
    })
  })
}
