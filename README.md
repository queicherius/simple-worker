# simple-worker

[![Build Status](https://img.shields.io/travis/queicherius/simple-worker.svg?style=flat-square)](https://travis-ci.org/queicherius/simple-worker)
[![Coverage Status](https://img.shields.io/codecov/c/github/queicherius/simple-worker/master.svg?style=flat-square)](https://codecov.io/github/queicherius/simple-worker)

> A drop-dead simple priority job queue, based on [kue](https://github.com/Automattic/kue)

## Install

```
npm install simple-worker
```

## Usage

```js
import * as worker from 'simple-worker'

// ===== PRODUCER =====

// Setup the worker
worker.setup()

// Queue a job for consumption
worker.queueJob({
  name: 'send-email',
  title: 'Sending an email to bib',
  data: {receiver: 'bib@bob.com'}
})

// ===== CONSUMER =====

// Setup the worker
worker.setup()

// Register the "handler" function connected to the job
worker.registerJob('send-email', (job, done) => {
  console.log('Sending email an email to ' + job.data.receiver)
  done()
})

// Process incoming jobs, sequentially. For parallel processing,
// spawn multiple processes, e.g. using the "cluster" module (see below)
worker.processJobs()

// ===== WEB INTERFACE =====

// Setup the worker
worker.setup()

// Start the web interface on port 3000
worker.webInterface(3000)

// Start the web interface on port 3000 using a username (foo) and password (bar)
worker.webInterface(3000, 'foo', 'bar')
```

#### Options for setting up the worker

`setup` takes an object of options with which you can e.g. customise the connection to redis:

```js
worker.setup({
  // Prefix for keys of the queued job
  prefix: 'q',
  
  // Configuration for node-redis
  // See: https://github.com/NodeRedis/node_redis#options-object-properties
  redis: {
    port: 1234,
    host: '10.0.50.20',
    auth: 'password'
  }
})
```

#### Options for creating jobs

`createJob` takes multiple different options with which you can customise the behaviour:

- **`name` (required)** - The identifier of the job, as needed for the `registerJob` function
- **`title` (required)** - A human-readable title for the job, this is the display name in the web interface
- **`data`** - An object with data the job can access via `job.data`. Useful for giving parameters to the job. Defaults to `{}`.
- **`priority`** - Any of `low`, `normal`, `medium`, `high` and `critical`. Determines with which priority the job will get processed. Jobs with a higher priority will always get processed earlier. Defaults to `normal`.
- **`attempts`** - How many times a job may be processed before getting marked as failed. Default: `1`
- **`backoff`** - How much re-attempts of jobs upon failures are delayed. Default: `{delay: 30 * 1000, type: 'exponential'}`
- **`schedule`** - A schedule of this job, similar to cronjobs. The format is described [here](https://github.com/node-schedule/node-schedule#cron-style-scheduling). Default: `false`
- **`ttl`** - How long a job may be processed before failing as "timed out" (in ms). Default: `60 * 60 * 1000` 
- **`delay`** - How long a job should be delayed before getting processed (in ms) or a `Date` in the future. Default: `false`
- **`callback`** - A function getting called when the job exists with `done`. Typical node callback with the structure `(err, result)`. Default: `noop`

#### Job handler function

`registerJob` takes a handler function with a `job` object and a `done` function. It offers the following functions:

- **`job.log(string)`** - Add a job specific log string which gets displayed in the web interface
- **`job.process(completed, total [, data])`** - Update a jobs process which gets displayed in the web interface
- **`done(new Error('Oh no.'))`** - Exit a job with an error (gets passed to the optional callback)
- **`done(null, 'Yay!')`** - Exit a job with a successful result (gets passed to the optional callback)

## Example for clustering

Below is an example of how you might cluster the processing part of this module. 
Another option would be using something like [pm2](https://github.com/Unitech/pm2).

```js
import cluster from 'cluster'
import os from 'os'
import worker from 'simple-worker'
const clusterSize = os.cpus().length * 3

if (cluster.isMaster) {
  for (var i = 0; i < clusterSize; i++) {
    cluster.fork()
  }
} else {
  worker.setup()
  worker.registerJob('some-name', someFunction)
  worker.processJobs()
}
```

## Debugging

This module uses [`debug`](https://github.com/visionmedia/debug),
so you can inspect what it does after setting the environment `DEBUG='simple-worker'

## Testing

You can test `simple-worker` [the same way that `kue` can be tested](https://github.com/Automattic/kue#testing).

## Tests

```
npm test
```

## Licence

MIT
