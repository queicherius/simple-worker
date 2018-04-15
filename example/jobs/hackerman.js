async function hackerman (job) {
  // Get data for a queued job (queued via `queue.add('hackerman', {target: '...')`)
  const target = job.data.target

  // Log a simple message
  job.info(`Hackerman is off to hack the >> ${target} <<`)

  // throw new Error('We got caught!!')

  return 'Hack compl3te'
}

module.exports = hackerman
