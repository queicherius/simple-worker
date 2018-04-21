async function sendReminders (job) {
  const users = ['Harald', 'David']

  // You can use async function as you are used to!
  for (let i = 0; i !== users.length; i++) {
    await sendMail(users[i])
  }

  // Logging can also include additional JSON data
  job.error(`Something went wrong`, {
    issue: 'Mainframe is not available'
  })

  // You can queue follow up jobs from inside of jobs
  job.add('hackerman', {target: 'Mainframe'})

  // To exit with an error, just throw
  throw new Error('Stuff is broke')
}

async function sendMail (name) {
  // Do fancy async stuff.
}

module.exports = sendReminders
