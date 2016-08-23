/* eslint-env node, mocha */
const expect = require('chai').expect
import kue from 'kue'
import * as worker from '../src/index'
const queue = worker.setup()

const getJobs = function (type, state, callback) {
  kue.Job.rangeByType('simple-worker', state, 0, -1, 'asc', (err, results) => {
    if (err) return callback(err)
    callback(null, results.filter(x => x.data.handler === type))
  })
}

describe('simple-worker', function () {
  this.timeout(5000)
  beforeEach((done) => {
    queue.client.flushdb(done)
  })

  it('throws an error if options are missing', () => {
    const error = "A 'name' and a 'title' have to be provided"
    expect(() => worker.queueJob({name: 'asd'})).to.throw(error)
    expect(() => worker.queueJob({title: 'asd'})).to.throw(error)
  })

  it('queues a job with the correct options', (done) => {
    worker.queueJob({name: 'test', title: 'Some test job'})

    getJobs('test', 'inactive', (err, jobs) => {
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

  it('schedules a job', (done) => {
    worker.queueJob({
      name: 'test',
      title: 'A scheduled test job',
      schedule: '* * * * * *'
    })

    setTimeout(() => {
      getJobs('test', 'inactive', (err, jobs) => {
        expect(err).to.equal(null)
        expect(jobs.length).to.equal(3)
        done()
      })
    }, 3500)
  })

  it('processes a job', (done) => {
    let processed = false
    worker.queueJob({name: 'test', title: 'Some test job'})

    worker.registerJob('test', (job, done) => {
      processed = true
      done()
    })

    worker.processJobs()

    setTimeout(() => {
      getJobs('test', 'inactive', (err, jobs) => {
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

    worker.registerJob('test', (job, done) => {
      throw new Error('Welp')
    })

    worker.processJobs()

    setTimeout(() => {
      getJobs('test', 'inactive', (err, jobs) => {
        expect(err).to.equal(null)
        expect(jobs.length).to.equal(0)
        done()
      })
    }, 500)
  })

  it('handles an error in a promise job', (done) => {
    worker.queueJob({name: 'test', title: 'Some test job'})
    worker.queueJob({name: 'test', title: 'Some test job'})

    worker.registerJob('test', async (job, done) => {
      throw new Error('Welp')
    })

    worker.processJobs()

    setTimeout(() => {
      getJobs('test', 'inactive', (err, jobs) => {
        expect(err).to.equal(null)
        expect(jobs.length).to.equal(0)
        done()
      })
    }, 500)
  })

  it('can start the web interface', () => {
    worker.webInterface(3000)
    worker.webInterface(3001, 'herp', 'derp')
  })
})
