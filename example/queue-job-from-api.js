const express = require('express')
const queue = require('./queue')
const app = express()

app.get('/hack/:target', function (req, res) {
  queue.add('hackerman', { target: req.params.target })
  res.send('Job queued!')
})

app.listen(3000)
