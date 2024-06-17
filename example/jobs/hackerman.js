async function hackerman (job) {
  await sleep(10)

  // Get data for a queued job (queued via `queue.add('hackerman', {target: '...')`)
  const target = job.data.target

  // Logging can also include additional JSON data
  job.info('hack_started', { target })

  // throw new Error('We got caught!!')

  // Return a value (will be logged with the job completion log)
  return 'Hack compl3te'
}

async function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = hackerman
