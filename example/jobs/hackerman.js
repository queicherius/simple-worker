async function hackerman (job) {
  // Get data for a queued job (queued via `queue.add('hackerman', {target: '...')`)
  const target = job.data.target

  // Log a simple message
  job.info(`Hackerman is off to hack the ${target}`)
}

module.exports = hackerman
