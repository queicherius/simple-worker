/* eslint-env node, mocha */
/* global process */
import {expect} from 'chai'
import sleep from 'sleep-promise'
import * as worker from '../src/index'

const listJobs = function (type, state, callback) {
  worker.listJobs(state)
    .then(results => callback(null, results.filter(x => x.data.handler === type)))
    .catch(err => callback(err))
}

function fakeCliProcess (options, args, callback) {
  let tmpArgv = process.argv
  let tmpExit = process.exit
  let tmpLog = console.log

  // Hide output
  console.log = () => false

  // Catch the exit code to give back later
  let exitCode = false
  process.exit = (code = 0) => {
    exitCode = code
  }

  // Fake the CLI arguments
  process.argv = [
    'node',
    '/Users/david/Projects/some-project/src/worker/cli'
  ].concat(args)

  // Execute the cli, clean up after ourselves and return the exit code
  setTimeout(() => {
    worker.cli(options)

    process.argv = tmpArgv
    process.exit = tmpExit
    console.log = tmpLog

    setTimeout(() => {
      callback(exitCode)
    }, 200)
  }, 200)
}

describe('simple-worker', function () {
  this.timeout(5000)

  // Before each test shut down any running processing handlers,
  // start a new queue, wait for the redis connection and then flush queued jobs
  beforeEach(async () => {
    await worker.reset()
  })

  describe('processing', () => {
    it('throws an error if options are missing', () => {
      const error = "A 'name' and a 'title' have to be provided"
      expect(() => worker.queueJob({name: 'asd'})).to.throw(error)
      expect(() => worker.queueJob({title: 'asd'})).to.throw(error)
    })

    it('queues a job with the correct options', (done) => {
      worker.queueJob({name: 'test', title: 'Some test job'})

      listJobs('test', 'inactive', (err, jobs) => {
        expect(err).to.equal(null)
        expect(jobs.length).to.equal(1)

        const job = jobs[0]
        expect(job.data).to.deep.equal({handler: 'test', title: 'Some test job'})
        expect(job._priority).to.equal(-5)
        expect(job._max_attempts).to.equal(1)
        expect(job._backoff).to.deep.equal({delay: 30000, type: 'exponential'})
        expect(parseInt(job._ttl, 10)).to.equal(3600000)
        expect(job._delay).to.be.equal(undefined)
        done()
      })
    })

    it('can list the jobs', async () => {
      await worker.queueJob({name: 'test', title: 'Some test job'})
      await worker.queueJob({name: 'test2', title: 'Some other test job'})
      await worker.queueJob({name: 'test', title: 'Some test job'})

      const jobs = await worker.listJobs('inactive')
      expect(jobs.length).to.equal(3)
      expect(jobs.map(x => x.data.handler)).to.deep.equal(['test', 'test2', 'test'])
    })

    it('can clear the jobs', async () => {
      await worker.queueJob({name: 'test', title: 'Some test job'})
      await worker.queueJob({name: 'test2', title: 'Some other test job'})
      await worker.queueJob({name: 'test', title: 'Some test job'})

      await worker.clearJobs('inactive')
      const jobs = await worker.listJobs('inactive')
      expect(jobs.length).to.equal(0)
    })

    it('schedules a job', (done) => {
      worker.queueJob({
        name: 'test', title: 'A scheduled test job', schedule: '* * * * * *'
      })

      setTimeout(() => {
        listJobs('test', 'inactive', (err, jobs) => {
          expect(err).to.equal(null)
          expect(jobs.length).to.equal(3)
          done()
        })
      }, 3500)
    })

    it('processes a job', (done) => {
      let processed = false
      worker.queueJob({name: 'test', title: 'Some test job'})

      worker.registerJob('test', (job, jobDone) => {
        processed = true
        job.log('Hey there')
        jobDone()
      })

      worker.processJobs()

      setTimeout(() => {
        listJobs('test', 'inactive', (err, jobs) => {
          expect(err).to.equal(null)
          expect(jobs.length).to.equal(0)
          expect(processed).to.equal(true)
          done()
        })
      }, 500)
    })

    it('handles an error in a synchronous job', (done) => {
      worker.queueJob({name: 'test', title: 'Some test job'})
      worker.queueJob({name: 'test', title: 'Some test job'})

      worker.registerJob('test', () => {
        throw new Error('Oh no.')
      })

      worker.processJobs()

      setTimeout(() => {
        listJobs('test', 'inactive', (err, jobs) => {
          expect(err).to.equal(null)
          expect(jobs.length).to.equal(0)
          done()
        })
      }, 500)
    })

    it('handles an error in a promise job', (done) => {
      worker.queueJob({name: 'test', title: 'Some test job'})
      worker.queueJob({name: 'test', title: 'Some test job'})

      worker.registerJob('test', async () => {
        throw new Error('Welp.')
      })

      worker.processJobs()

      setTimeout(() => {
        listJobs('test', 'inactive', (err, jobs) => {
          expect(err).to.equal(null)
          expect(jobs.length).to.equal(0)
          done()
        })
      }, 500)
    })
  })

  describe('monitoring', () => {
    it('monitors a queued job', async () => {
      worker.queueJob({name: 'test-queued', title: 'Some test job'})

      const jobs = await worker.monitoring.getData()
      expect(jobs.length).to.equal(1)
      expect(jobs[0].name).to.equal('test-queued')
      expect(jobs[0].stats).to.deep.equal({queued: 1, active: 0, completed: 0, timeout: 0, failed: 0, total: 1})
      expect(jobs[0].history.length).to.equal(0)
    })

    it('monitors an active job', (done) => {
      worker.queueJob({name: 'test-active', title: 'Some test job'})
      worker.registerJob('test-active', (job, jobDone) => {
        setTimeout(() => {
          jobDone()
        }, 3000)
      })
      worker.processJobs()

      setTimeout(async () => {
        const jobs = await worker.monitoring.getData()
        expect(jobs.length).to.equal(1)
        expect(jobs[0].name).to.equal('test-active')
        expect(jobs[0].stats).to.deep.equal({queued: 0, active: 1, completed: 0, timeout: 0, failed: 0, total: 1})
        expect(jobs[0].history.length).to.equal(0)
        done()
      }, 500)
    })

    it('monitors a completed job', (done) => {
      worker.queueJob({name: 'test-completed', title: 'Some test job'})
      worker.registerJob('test-completed', (job, jobDone) => {
        jobDone()
      })
      worker.processJobs()

      setTimeout(async () => {
        const jobs = await worker.monitoring.getData()
        expect(jobs.length).to.equal(1)
        expect(jobs[0].name).to.equal('test-completed')
        expect(jobs[0].stats).to.deep.equal({queued: 0, active: 0, completed: 1, timeout: 0, failed: 0, total: 1})
        expect(jobs[0].history.length).to.equal(1)
        expect(jobs[0].history[0].length).to.equal(3)
        expect(jobs[0].history[0][0]).to.be.a.number
        expect(jobs[0].history[0][1]).to.equal('completed')
        expect(jobs[0].history[0][2]).to.be.a.number
        done()
      }, 500)
    })

    it('monitors a failed job', (done) => {
      worker.queueJob({name: 'test-failed', title: 'Some test job'})
      worker.registerJob('test-failed', () => {
        throw new Error('Oh no.')
      })
      worker.processJobs()

      setTimeout(async () => {
        const jobs = await worker.monitoring.getData()
        expect(jobs.length).to.equal(1)
        expect(jobs[0].name).to.equal('test-failed')
        expect(jobs[0].stats).to.deep.equal({queued: 0, active: 0, completed: 0, timeout: 0, failed: 1, total: 1})
        expect(jobs[0].history.length).to.equal(1)
        expect(jobs[0].history[0].length).to.equal(3)
        expect(jobs[0].history[0][0]).to.be.a.number
        expect(jobs[0].history[0][1]).to.equal('failed')
        expect(jobs[0].history[0][2]).to.be.a.number
        done()
      }, 500)
    })

    it('monitors a timed out job', (done) => {
      worker.queueJob({name: 'test-ttl', title: 'Some test job', ttl: 250})
      worker.registerJob('test-ttl', async (job, jobDone) => {
        await sleep(3000)
        jobDone()
      })
      worker.processJobs()

      setTimeout(async () => {
        const jobs = await worker.monitoring.getData()
        expect(jobs.length).to.equal(1)
        expect(jobs[0].name).to.equal('test-ttl')
        expect(jobs[0].stats).to.deep.equal({queued: 0, active: 0, completed: 0, timeout: 1, failed: 0, total: 1})
        expect(jobs[0].history.length).to.equal(1)
        expect(jobs[0].history[0].length).to.equal(3)
        expect(jobs[0].history[0][0]).to.be.a.number
        expect(jobs[0].history[0][1]).to.equal('timeout')
        expect(jobs[0].history[0][2]).to.be.a.number
        done()
      }, 4000)
    })

    it('monitors retrying jobs correctly', (done) => {
      worker.queueJob({name: 'test-retry', title: 'Some test job', ttl: 250, attempts: 2, backoff: 1000})
      worker.registerJob('test-retry', async (job, jobDone) => {
        await sleep(1000)
        jobDone()
      })
      worker.processJobs()

      setTimeout(async () => {
        const jobs = await worker.monitoring.getData()
        expect(jobs.length).to.equal(1)
        expect(jobs[0].name).to.equal('test-retry')
        expect(jobs[0].stats).to.deep.equal({queued: 0, active: 0, completed: 0, timeout: 2, failed: 0, total: 2})
        expect(jobs[0].history.length).to.equal(2)
        jobs[0].history.map(entry => {
          expect(entry.length).to.equal(3)
          expect(entry[0]).to.be.a.number
          expect(entry[1]).to.equal('timeout')
          expect(entry[2]).to.be.a.number
        })
        done()
      }, 4000)
    })
  })

  describe('web', () => {
    it('can start the interface', () => {
      worker.webInterface(3000)
      worker.webInterface(3001, 'herp', 'derp')
    })
  })

  describe('cli', () => {
    it('processes a job inline', (done) => {
      let processed = false

      worker.registerJob('cli-test-1', (job, jobDone) => {
        processed = true
        job.log('Hey there')
        jobDone()
      })

      fakeCliProcess({}, ['cli-test-1'], exitCode => {
        expect(exitCode).to.equal(0)

        listJobs('cli-test-1', 'inactive', (err, jobs) => {
          expect(err).to.equal(null)
          expect(jobs.length).to.equal(0)
          expect(processed).to.equal(true)
          done()
        })
      })
    })

    it('throws an error if the job fails', (done) => {
      let processed = false

      worker.registerJob('cli-test-5', (job) => {
        processed = true
        job.log('Hey there')
        throw new Error('Oh no.')
      })

      fakeCliProcess({}, ['cli-test-5'], exitCode => {
        expect(exitCode).to.equal(1)

        listJobs('cli-test-5', 'inactive', (err, jobs) => {
          expect(err).to.equal(null)
          expect(jobs.length).to.equal(0)
          expect(processed).to.equal(true)
          done()
        })
      })
    })

    it('queues a job', (done) => {
      fakeCliProcess({}, ['cli-test-2', '-q'], exitCode => {
        expect(exitCode).to.equal(false)

        listJobs('cli-test-2', 'inactive', (err, jobs) => {
          expect(err).to.equal(null)
          expect(jobs.length).to.equal(1)

          const job = jobs[0]
          expect(job.data).to.deep.equal({
            handler: 'cli-test-2',
            title: '[CLI] Queued "cli-test-2" via the CLI'
          })
          expect(job._priority).to.equal(-10)
          expect(job._max_attempts).to.equal(1)
          expect(job._backoff).to.deep.equal({delay: 30000, type: 'exponential'})
          expect(parseInt(job._ttl, 10)).to.equal(3600000)
          expect(job._delay).to.be.equal(undefined)
          done()
        })
      })
    })

    it('can give data to a job', (done) => {
      fakeCliProcess({}, ['cli-test-3', '-q', `--data={"foo": "bar"}`], exitCode => {
        expect(exitCode).to.equal(false)

        listJobs('cli-test-3', 'inactive', (err, jobs) => {
          expect(err).to.equal(null)
          expect(jobs.length).to.equal(1)

          const job = jobs[0]
          expect(job.data).to.deep.equal({
            handler: 'cli-test-3',
            title: '[CLI] Queued "cli-test-3" via the CLI',
            foo: 'bar'
          })
          expect(job._priority).to.equal(-10)
          expect(job._max_attempts).to.equal(1)
          expect(job._backoff).to.deep.equal({delay: 30000, type: 'exponential'})
          expect(parseInt(job._ttl, 10)).to.equal(3600000)
          expect(job._delay).to.be.equal(undefined)
          done()
        })
      })
    })

    it('throws an error if the job name is invalid', (done) => {
      fakeCliProcess({validJobs: ['cli-test-4']}, ['cli-test-99999'], exitCode => {
        expect(exitCode).to.equal(1)
        done()
      })
    })
  })
})
