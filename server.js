// server.js
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const http = require('http');
const WebSocket = require('ws');
const SimpleGit = require('simple-git');
const git = SimpleGit();

const DATA_FILE = path.join(__dirname, 'issues.json');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// create server and attach ws
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// utility: load data
async function loadData() {
  try {
    const text = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    // if not exists, initialize
    const initial = { nextId: 1, issues: [] };
    await saveData(initial);
    return initial;
  }
}

// utility: save data and commit to git
async function saveData(data, commitMessage = null) {
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(DATA_FILE, json, 'utf8');

  // Stage and commit using simple-git
  try {
    await git.add(DATA_FILE);
    // build commit message if null
    const message = commitMessage || `Update issues.json`;
    await git.commit(message);
    console.log('Committed to git:', message);
  } catch (err) {
    console.error('Git commit failed:', err.message);
  }
}

// Broadcast helper
function broadcastJSON(obj) {
  const payload = JSON.stringify(obj);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// WebSocket message handling
wss.on('connection', async (ws) => {
  console.log('Client connected');

  // on new connection, send current state
  const data = await loadData();
  ws.send(JSON.stringify({ type: 'init', data }));

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      const current = await loadData();

      if (msg.type === 'create_issue') {
        // expected msg.payload = { title, description, createdBy }
        const id = current.nextId++;
        const newIssue = {
          id,
          title: msg.payload.title,
          description: msg.payload.description || '',
          status: 'Open',
          createdBy: msg.payload.createdBy || 'Anonymous',
          comments: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        current.issues.push(newIssue);

        const commitMsg = `Issue #${id} created by ${newIssue.createdBy}: ${newIssue.title}`;
        await saveData(current, commitMsg);

        broadcastJSON({ type: 'issue_created', issue: newIssue });

      } else if (msg.type === 'update_issue') {
        // payload = { id, fields: {status?, title?, description?}, updatedBy }
        const { id, fields, updatedBy } = msg.payload;
        const issue = current.issues.find(i => i.id === id);
        if (!issue) {
          ws.send(JSON.stringify({ type: 'error', message: 'Issue not found' }));
          return;
        }
        Object.assign(issue, fields);
        issue.updatedAt = new Date().toISOString();

        const commitMsg = `Issue #${id} updated by ${updatedBy || 'Unknown'}: ${JSON.stringify(fields)}`;
        await saveData(current, commitMsg);

        broadcastJSON({ type: 'issue_updated', issue });

      } else if (msg.type === 'add_comment') {
        // payload = { id, comment: { author, text } }
        const { id, comment } = msg.payload;
        const issue = current.issues.find(i => i.id === id);
        if (!issue) {
          ws.send(JSON.stringify({ type: 'error', message: 'Issue not found' }));
          return;
        }
        const commentObj = {
          id: Date.now(), // or UUID
          author: comment.author || 'Anonymous',
          text: comment.text,
          createdAt: new Date().toISOString()
        };
        issue.comments.push(commentObj);
        issue.updatedAt = new Date().toISOString();

        const commitMsg = `Issue #${id} commented by ${commentObj.author}: "${commentObj.text}"`;
        await saveData(current, commitMsg);

        broadcastJSON({ type: 'comment_added', issueId: id, comment: commentObj });

      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
      }
    } catch (err) {
      console.error('Message handling error:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => console.log('Client disconnected'));
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
