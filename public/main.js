// public/main.js
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
let state = { nextId: 1, issues: [] };

function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function render() {
  const tbody = document.querySelector('#issuesTable tbody');
  tbody.innerHTML = '';
  state.issues.forEach(issue => {
    const tr = document.createElement('tr');

    const commentsCell = document.createElement('td');
    if (issue.comments && issue.comments.length) {
      issue.comments.forEach(c => {
        const div = document.createElement('div');
        div.className = 'comment';
        div.textContent = `${c.author}: ${c.text} (${new Date(c.createdAt).toLocaleString()})`;
        commentsCell.appendChild(div);
      });
    } else commentsCell.textContent = '—';

    const actionsCell = document.createElement('td');

    // Status dropdown
    const statusSelect = document.createElement('select');
    ['Open', 'In Progress', 'Closed'].forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      if (s === issue.status) opt.selected = true;
      statusSelect.appendChild(opt);
    });
    statusSelect.addEventListener('change', () => {
      ws.send(JSON.stringify({
        type: 'update_issue',
        payload: { id: issue.id, fields: { status: statusSelect.value }, updatedBy: (document.querySelector('#createdBy').value || 'Unknown') }
      }));
    });

    // Comment input
    const commentInput = document.createElement('input');
    commentInput.placeholder = 'Comment...';
    const commentBtn = document.createElement('button');
    commentBtn.textContent = 'Add';
    commentBtn.addEventListener('click', () => {
      const text = commentInput.value.trim();
      if (!text) return;
      ws.send(JSON.stringify({
        type: 'add_comment',
        payload: { id: issue.id, comment: { author: (document.querySelector('#createdBy').value || 'Anonymous'), text } }
      }));
      commentInput.value = '';
    });

    actionsCell.appendChild(statusSelect);
    actionsCell.appendChild(document.createElement('br'));
    actionsCell.appendChild(commentInput);
    actionsCell.appendChild(commentBtn);

    tr.innerHTML = `<td>${issue.id}</td>
                    <td><strong>${escapeHtml(issue.title)}</strong><div style="font-size:0.9em;color:#666">${escapeHtml(issue.description)}</div></td>
                    <td class="status">${issue.status}</td>
                    <td>${escapeHtml(issue.createdBy)}</td>`;
    tr.appendChild(commentsCell);
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });
}

// WebSocket events
ws.addEventListener('open', () => console.log('WS connected'));
ws.addEventListener('message', ev => {
  try {
    const msg = JSON.parse(ev.data);

    if (msg.type === 'init') {
      state = msg.data;
      render();
    } else if (msg.type === 'issue_created') {
      state.issues.push(msg.issue);
      render();
    } else if (msg.type === 'issue_updated') {
      state.issues = state.issues.map(i => i.id === msg.issue.id ? msg.issue : i);
      render();
    } else if (msg.type === 'comment_added') {
      const issue = state.issues.find(i => i.id === msg.issueId);
      if (issue) {
        issue.comments = issue.comments || [];
        issue.comments.push(msg.comment);
        render();
      }
    } else if (msg.type === 'error') {
      alert('Server error: ' + msg.message);
    }
  } catch (err) { console.error('WS parse error', err); }
});

// Create issue button
document.getElementById('createBtn').addEventListener('click', () => {
  const title = document.getElementById('title').value.trim();
  const desc = document.getElementById('description').value.trim();
  const createdBy = document.getElementById('createdBy').value.trim() || 'Anonymous';
  if (!title) return alert('Enter title');
  ws.send(JSON.stringify({ type: 'create_issue', payload: { title, description: desc, createdBy } }));
  document.getElementById('title').value = '';
  document.getElementById('description').value = '';
});
