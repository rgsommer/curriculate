// dev/e2e/teardownSession.js
// Deletes TaskSet and Session created by setupSession.js using session-info.json

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

async function main() {
  const infoPath = path.resolve(__dirname, 'session-info.json');
  if (!fs.existsSync(infoPath)) {
    console.log('No session-info.json found; nothing to tear down');
    return;
  }

  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/curriculate';

  const TaskSet = require(path.resolve(__dirname, '../../backend/models/TaskSet.js'));
  const Session = require(path.resolve(__dirname, '../../backend/models/Session.js'));

  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    if (info.sessionId) {
      await Session.deleteOne({ _id: info.sessionId });
      console.log('Deleted session', info.sessionId);
    }
    if (info.taskSetId) {
      await TaskSet.deleteOne({ _id: info.taskSetId });
      console.log('Deleted taskSet', info.taskSetId);
    }
    fs.unlinkSync(infoPath);
    console.log('Teardown complete');
  } catch (err) {
    console.error('Teardown error', err);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
