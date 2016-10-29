/* eslint-env node, mocha */
import {expect} from 'chai'
import * as worker from '../src/index'
const queue = worker.setup()

const listJobs = function (type, state, callback) {
  worker.listJobs(state)
    .then(results => callback(null, results.filter(x => x.data.handler === type)))
    .catch(err => callback(err))
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
      name: 'test',
      title: 'A scheduled test job',
      schedule: '* * * * * *'
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

    worker.registerJob('test', (job, done) => {
      processed = true
      job.log('Hey there')
      done()
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

    worker.registerJob('test', (job, done) => {
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

    worker.registerJob('test', async (job, done) => {
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

  it('can start the web interface', () => {
    worker.webInterface(3000)
    worker.webInterface(3001, 'herp', 'derp')
  })
})
