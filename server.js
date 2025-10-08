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
const AUTO_PUSH = (process.env.AUTO_PUSH || 'true').toLowerCase() !== 'false';

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let currentBranch = 'master';
let hasRemote = false;

// Detect branch and remote
(async function detectGit() {
  try {
    const branchInfo = await git.branchLocal();
    currentBranch = branchInfo.current || 'master';
  } catch (err) { console.warn('Branch detect failed:', err.message); }

  try {
    const rems = await git.getRemotes(true);
    hasRemote = Array.isArray(rems) && rems.length > 0;
  } catch (err) { hasRemote = false; }

  console.log('Git: branch=', currentBranch, 'hasRemote=', hasRemote, 'AUTO_PUSH=', AUTO_PUSH);
})();

// Broadcast helper
function broadcastJSON(obj) {
  const payload = JSON.stringify(obj);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// Load data
async function loadData() {
  try {
    const text = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(text);
  } catch {
    const initial = { nextId: 1, issues: [] };
    await fs.writeFile(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
}

// Write file only
async function writeDataFile(data) {
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(DATA_FILE, json, 'utf8');
}

// Commit and push
async function commitAndPush(commitMessage) {
  try {
    await git.add(DATA_FILE);
    await git.commit(commitMessage);
    console.log('Committed:', commitMessage);
  } catch (err) {
    console.error('git commit failed:', err.message);
    return;
  }

  if (!hasRemote || !AUTO_PUSH) return;

  try {
    await git.push('origin', currentBranch);
    console.log('Pushed to remote');
  } catch (err) {
    console.error('git push failed:', err.message);
  }
}

// WebSocket connection
wss.on('connection', async (ws) => {
  console.log('Client connected');
  const data = await loadData();
  ws.send(JSON.stringify({ type: 'init', data }));

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      const current = await loadData();

      if (msg.type === 'create_issue') {
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

        await writeDataFile(current);
        broadcastJSON({ type: 'issue_created', issue: newIssue });
        commitAndPush(`Issue #${id} created by ${newIssue.createdBy}: ${newIssue.title}`);

      } else if (msg.type === 'update_issue') {
        const { id, fields, updatedBy } = msg.payload;
        const issue = current.issues.find(i => i.id === id);
        if (!issue) return ws.send(JSON.stringify({ type: 'error', message: 'Issue not found' }));

        Object.assign(issue, fields);
        issue.updatedAt = new Date().toISOString();

        await writeDataFile(current);
        broadcastJSON({ type: 'issue_updated', issue });
        commitAndPush(`Issue #${id} updated by ${updatedBy || 'Unknown'}: ${JSON.stringify(fields)}`);

      } else if (msg.type === 'add_comment') {
        const { id, comment } = msg.payload;
        const issue = current.issues.find(i => i.id === id);
        if (!issue) return ws.send(JSON.stringify({ type: 'error', message: 'Issue not found' }));

        const commentObj = {
          id: Date.now(),
          author: comment.author || 'Anonymous',
          text: comment.text,
          createdAt: new Date().toISOString()
        };
        issue.comments.push(commentObj);
        issue.updatedAt = new Date().toISOString();

        await writeDataFile(current);
        // Broadcast ONLY the comment so other windows can append instantly
        broadcastJSON({ type: 'comment_added', issueId: id, comment: commentObj });

        commitAndPush(`Issue #${id} commented by ${commentObj.author}: "${commentObj.text}"`);
      }

    } catch (err) {
      console.error('Message handling error:', err);
      try { ws.send(JSON.stringify({ type: 'error', message: err.message })); } catch {}
    }
  });

  ws.on('close', () => console.log('Client disconnected'));
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
