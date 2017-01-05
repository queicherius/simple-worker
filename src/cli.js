/* global process */
import commander from 'commander'
import chalk from 'chalk'
import {queueJob, processJob} from './index.js'

const log = {
  info: (string) => console.log(chalk.gray(string)),
  success: (string) => console.log(chalk.green(string)),
  error: (string) => console.log(chalk.bold.red(string))
}

const defaultOptions = {
  validJobs: false
}

export default function (options) {
  options = {...defaultOptions, ...options}
  const args = parseArguments()

  if (options.validJobs) {
    validateJobName(args.name, options.validJobs)
  }

  if (args.queue) {
    return executeQueued(args)
  }

  return executeInline(args)
}

function parseArguments () {
  let jobName = false

  commander
    .usage('job-name [options]')
    .description('Command line interface for executing or queueing jobs')
    .option('-q, --queue', 'Queue the job instead of executing it inline')
    .option('-d, --data [value]', 'The data object for the job, as stringified JSON', (val) => JSON.parse(val), {})
    .action((job) => {
      jobName = job
    })
    .parse(process.argv)

  return {name: jobName, data: commander.data, queue: commander.queue}
}

function validateJobName (name, validNames) {
  if (name && validNames.indexOf(name) !== -1) {
    return true
  }

  validNames = validNames.map(job => `  - ${job}`).join('\n')
  log.error(`This job name is invalid. Please specify one of the following:\n${validNames}`)
  process.exit(1)
}

function executeQueued (args) {
  log.success(`Queueing job "${args.name}"`)
  log.info('Please wait until the queued job gets processed...')

  queueJob({
    name: args.name,
    title: `[CLI] Queued "${args.name}" via the CLI`,
    priority: 'high',
    data: args.data,
    callback: doneOverwrite
  })
}

function executeInline (args) {
  log.success(`Executing job "${args.name}"`)

  const jobOverwrite = {
    log: log.info,
    data: {...args.data, handler: args.name}
  }

  processJob(jobOverwrite, doneOverwrite, true)
}

function doneOverwrite (err, result) {
  if (err) {
    log.error(`An error occurred in the job:\n${err}`)
    return process.exit(1)
  }

  result = result ? `\n${result}` : ''
  log.success(`Job finished successfully.${result}`)
  process.exit(0)
}
