// popup.js — FB Posts Deleter by Stacknix.dev

let isRunning = false;

const statusBox = document.getElementById('status-box');
const cntDeleted = document.getElementById('cnt-deleted');
const cntSkipped = document.getElementById('cnt-skipped');
const cntTotal = document.getElementById('cnt-total');
const indicatorDot = document.getElementById('indicator-dot');
const indicatorText = document.getElementById('indicator-text');

function addLog(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<div class="log-dot ${type}"></div><div class="log-text ${type}">${msg}</div>`;
  statusBox.appendChild(line);
  statusBox.scrollTop = statusBox.scrollHeight;
  while (statusBox.children.length > 40) {
    statusBox.removeChild(statusBox.firstChild);
  }
}

function updateCounters(deleted, skipped) {
  cntDeleted.textContent = deleted;
  cntSkipped.textContent = skipped;
  cntTotal.textContent = deleted + skipped;
}

function setRunning(val) {
  isRunning = val;
  document.body.classList.toggle('running', val);
  indicatorDot.classList.toggle('active', val);
  indicatorText.textContent = val ? 'running' : 'idle';
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'status') {
    addLog(msg.msg, msg.type || 'info');
    if (msg.deletedCount !== undefined) updateCounters(msg.deletedCount, msg.skippedCount || 0);
    if (msg.type === 'success' && msg.msg.toLowerCase().includes('done')) {
      setRunning(false);
    }
  }
});

async function getFBTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.url?.includes('facebook.com')) {
    addLog('❌ Please open a Facebook tab first!', 'error');
    return null;
  }
  return tab;
}

async function sendToContent(action) {
  const tab = await getFBTab();
  if (!tab) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    }).catch(() => {});
    const resp = await chrome.tabs.sendMessage(tab.id, { action });
    if (resp && !resp.ok) {
      addLog(resp.msg || 'Error sending command.', 'error');
    }
  } catch (e) {
    addLog('Cannot connect to page. Reload the Facebook tab.', 'error');
  }
}

document.getElementById('btn-delete-all').addEventListener('click', async () => {
  if (isRunning) return;
  setRunning(true);
  updateCounters(0, 0);
  addLog('Starting bulk delete via Activity Log...', 'info');
  await sendToContent('deleteAll');
});

document.getElementById('btn-stop').addEventListener('click', async () => {
  if (!isRunning) return;
  addLog('Stop requested...', 'warn');
  await sendToContent('stop');
  setRunning(false);
});

document.getElementById('btn-debug').addEventListener('click', async () => {
  addLog('Scanning page DOM...', 'info');
  await sendToContent('debug');
});

(async () => {
  const tab = await chrome.tabs.query({ active: true, currentWindow: true }).then((t) => t[0]);
  if (tab?.url?.includes('facebook.com')) {
    addLog('✓ Facebook tab detected. Ready.', 'success');
  } else {
    addLog('⚠ Open facebook.com to use this extension.', 'warn');
  }
})();
