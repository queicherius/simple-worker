async function sendReminders (job) {
  const users = ['Harald', 'David']

  // You can use async function as you are used to!
  for (let i = 0; i !== users.length; i++) {
    await sendMail(users[i])
  }

  // Log a simple message
  job.error('send_reminder_errored')

  // You can queue follow up jobs from inside of jobs
  job.add('hackerman', { target: 'Mainframe' })

  // To exit with an error, just throw
  throw new Error('Stuff is broke')
}

async function sendMail (name) {
  // Do fancy async stuff.
}

module.exports = sendReminders
