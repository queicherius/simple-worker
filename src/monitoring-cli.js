import chalk from 'chalk'
import sparkly from 'sparkly'
import pad from 'pad-right'
import Duration from 'duration'
import Table from 'cli-table'
import {getData} from './monitoring.js'

const defaultOptions = {
  refreshRate: 2000
}

export default function (options) {
  options = {...defaultOptions, ...options}

  // Setup the monitoring drawing
  setInterval(() => getData().then(drawTable), options.refreshRate)
}

// Draw the monitoring table
function drawTable (jobs) {
  jobs.sort((a, b) => a.name.localeCompare(b.name))

  var table = new Table({
    head: ['Name', 'Queued', 'Active', 'Completed', 'Timeout', 'Failed', 'Processing History'],
    chars: {'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': ''},
    style: {head: ['bold']}
  })

  table.push(['', '', '', '', '', '', ''])

  jobs.map(job => {
    table.push([
      job.name,
      job.stats.queued === 0 ? chalk.gray(0) : chalk.magenta(job.stats.queued),
      job.stats.active === 0 ? chalk.gray(0) : chalk.blue(job.stats.active),
      job.stats.completed === 0 ? chalk.gray(0) : chalk.green(job.stats.completed),
      job.stats.timeout === 0 ? chalk.gray(0) : chalk.yellow(job.stats.timeout),
      job.stats.failed === 0 ? chalk.gray(0) : chalk.red(job.stats.failed),
      pad(sparkly(job.history.slice(0, 25).map(x => x[0]), {min: 0}), 30, ' ') +
      job.history.slice(0, 10).map(x => formatStatus(x[1], formatDuration(x[0]))).join(', ')
    ])
  })

  table.push(['', '', '', '', '', '', ''])

  // Calculate the totals
  const totalQueued = jobs.map(job => job.stats.queued).reduce((a, b) => a + b, 0)
  const totalActive = jobs.map(job => job.stats.active).reduce((a, b) => a + b, 0)
  const totalCompleted = jobs.map(job => job.stats.completed).reduce((a, b) => a + b, 0)
  const totalTimeout = jobs.map(job => job.stats.timeout).reduce((a, b) => a + b, 0)
  const totalFailed = jobs.map(job => job.stats.failed).reduce((a, b) => a + b, 0)
  table.push([
    chalk.bold('TOTAL'),
    totalQueued === 0 ? chalk.bold.gray(0) : chalk.bold.magenta(totalQueued),
    totalActive === 0 ? chalk.bold.gray(0) : chalk.bold.blue(totalActive),
    totalCompleted === 0 ? chalk.bold.gray(0) : chalk.bold.green(totalCompleted),
    totalTimeout === 0 ? chalk.bold.gray(0) : chalk.bold.yellow(totalTimeout),
    totalFailed === 0 ? chalk.bold.gray(0) : chalk.bold.red(totalFailed),
    ''
  ])

  // Clear the screen and draw the table
  console.log('\x1B[2J\x1B[0f')
  console.log(table.toString())
}

// Format a job status as a color
function formatStatus (status, string) {
  if (status === 'completed') {
    return chalk.green(string)
  }

  if (status === 'timeout') {
    return chalk.yellow(string)
  }

  return chalk.red(string)
}

// Format a ms duration in human readable format
function formatDuration (ms) {
  var duration = new Duration(new Date(0), new Date(ms))
  return duration.toString(1).split(' ')[0]
}
