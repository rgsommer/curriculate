// dev/e2e/setupSession.js
// Creates a TaskSet and Session in the configured MongoDB for e2e tests.

const mongoose = require('mongoose');
const path = require('path');

async function main() {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/curriculate';
  // load models from backend
  const modelsPath = path.resolve(__dirname, '../../backend/models');
  // adjust NODE_PATH to include backend
  process.env.NODE_PATH = `${process.env.NODE_PATH || ''}:${modelsPath}`;
  require('module').Module._initPaths();

  // import models using relative paths
  const TaskSet = require(path.resolve(__dirname, '../../backend/models/TaskSet.js'));
  const Session = require(path.resolve(__dirname, '../../backend/models/Session.js'));

  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  const taskSet = await TaskSet.create({
    name: 'E2E Test Set',
    tasks: [
      {
        title: 'Multiplication',
        prompt: 'What is 6 x 7?',
        taskType: 'open_text',
        answer: '42',
        correctAnswer: '42',
        points: 10,
      },
    ],
  });

  // generate deterministic code
  const code = `E2E${Date.now().toString().slice(-4)}`;

  const session = await Session.create({
    code,
    taskSet: taskSet._id,
    state: 'lobby',
    currentTaskIndex: -1,
    teams: [
      { name: 'Team A', color: '#e53935', score: 0 },
      { name: 'Team B', color: '#1e88e5', score: 0 },
      { name: 'Team C', color: '#43a047', score: 0 },
    ],
  });

  console.log(code);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
