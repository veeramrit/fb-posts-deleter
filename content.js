// FB Posts Deleter — Stacknix.dev
// Content Script v1.0
// Deletes Facebook posts from Activity Log one by one automatically

(function () {
  if (window.__fbPostsDeleter) return;
  window.__fbPostsDeleter = true;

  let isRunning = false;
  let deletedCount = 0;
  let skippedCount = 0;
  let stopRequested = false;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function sendStatus(msg, type = 'info') {
    try {
      chrome.runtime.sendMessage({ action: 'status', msg, type, deletedCount, skippedCount });
    } catch (e) {}
  }

  // ─── Core DOM Helpers ────────────────────────────────────────────────────────

  function findByText(label, root = document) {
    const roles = ['button', 'menuitem', 'option', 'link', 'menuitemradio'];
    const roleSelector = roles.map((r) => `[role="${r}"]`).join(',');
    const candidates = [...root.querySelectorAll(`button, a, ${roleSelector}`)];
    for (const el of candidates) {
      if (el.textContent.trim() === label && el.offsetParent !== null) return el;
    }
    const lower = label.toLowerCase();
    for (const el of candidates) {
      if (el.textContent.trim().toLowerCase() === lower && el.offsetParent !== null) return el;
    }
    for (const el of candidates) {
      if (el.textContent.trim().toLowerCase().includes(lower) && el.offsetParent !== null) return el;
    }
    return null;
  }

  function findByAriaLabel(label, root = document) {
    const lower = label.toLowerCase();
    const all = [...root.querySelectorAll('[aria-label]')];
    return all.find(
      (el) => el.getAttribute('aria-label').toLowerCase().includes(lower) && el.offsetParent !== null
    ) || null;
  }

  async function pressEscape() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(300);
  }

  async function waitFor(fn, timeout = 3000, interval = 200) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = fn();
      if (el) return el;
      await sleep(interval);
    }
    return null;
  }

  // ─── Debug helpers ────────────────────────────────────────────────────────────

  function debugScanPage() {
    const info = [];
    const allBtns = [...document.querySelectorAll('[role="button"]')];
    info.push(`role=button: ${allBtns.length}`);
    const knownLabels = ['More options', 'More', 'Action options', 'Delete', 'Options', 'Edit or delete this', 'More options for this activity'];
    for (const lbl of knownLabels) {
      const found = findByAriaLabel(lbl);
      if (found) info.push(`✓ aria~="${lbl}"`);
    }
    const menus = document.querySelectorAll('[role="menu"], [role="dialog"]');
    info.push(`menus/dialogs: ${menus.length}`);
    sendStatus('[SCAN] ' + info.join(' | '), 'warn');
  }

  function dumpAriaLabels() {
    const els = [...document.querySelectorAll('[aria-label]')];
    const unique = [...new Set(
      els.filter((e) => e.offsetParent !== null)
        .map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute('role') || '—'}]="${e.getAttribute('aria-label').substring(0, 40)}"`)
    )].slice(0, 25);
    sendStatus('[LABELS] ' + unique.join(' | '), 'warn');
  }

  // ─── Step 1: Find first action button on Activity Log ────────────────────────

  function findFirstActivityActionButton() {
    const actionLabels = [
      'Action options',
      'More options for this activity',
      'Options',
      'More options',
      'Edit or delete this',
    ];
    for (const lbl of actionLabels) {
      const exact = document.querySelector(`[aria-label="${lbl}"]`);
      if (exact && exact.offsetParent !== null) return exact;
      const all = [...document.querySelectorAll(`[aria-label*="${lbl.split(' ')[0]}"]`)];
      for (const e of all) {
        if (e.offsetParent !== null) return e;
      }
    }
    return null;
  }

  // ─── Step 2: Click Delete in open menu ───────────────────────────────────────

  async function clickDeleteInOpenMenu() {
    await sleep(500);
    const menu = document.querySelector('[role="menu"]');
    const dialog = document.querySelector('[role="dialog"]');
    const root = menu || dialog || document;

    const delBtn = findByText('Delete', root);
    if (delBtn) {
      sendStatus('Clicking "Delete"', 'info');
      delBtn.click();
      await sleep(800);
      return true;
    }

    const delByLabel = findByAriaLabel('delete', root);
    if (delByLabel) {
      delByLabel.click();
      await sleep(800);
      return true;
    }

    const items = [...document.querySelectorAll('[role="menuitem"], [role="option"]')];
    for (const item of items) {
      if (item.textContent.toLowerCase().includes('delete') && item.offsetParent !== null) {
        item.click();
        await sleep(800);
        return true;
      }
    }
    return false;
  }

  // ─── Step 3: Confirm dialog ───────────────────────────────────────────────────

  async function confirmDeleteDialog() {
    await sleep(600);
    const dialog = await waitFor(() => document.querySelector('[role="dialog"]'), 3000);
    if (!dialog) {
      sendStatus('No confirm dialog — may have deleted directly', 'warn');
      return true;
    }

    const confirmBtn =
      findByText('Delete', dialog) ||
      findByText('Confirm', dialog) ||
      findByText('OK', dialog) ||
      findByAriaLabel('delete', dialog);

    if (confirmBtn) {
      sendStatus('Confirming deletion', 'info');
      confirmBtn.click();
      await sleep(1400);
      return true;
    }

    const allDialogBtns = [...dialog.querySelectorAll('[role="button"], button')].filter((b) => {
      const t = b.textContent.trim().toLowerCase();
      return t !== 'cancel' && t !== 'close' && t !== '' && b.offsetParent !== null;
    });

    if (allDialogBtns.length === 1) {
      allDialogBtns[0].click();
      await sleep(1400);
      return true;
    }

    sendStatus('Cannot find confirm button', 'error');
    await pressEscape();
    return false;
  }

  // ─── Main: Delete All Posts via Activity Log ──────────────────────────────────

  async function deleteAllPosts() {
    isRunning = true;
    stopRequested = false;
    deletedCount = 0;
    skippedCount = 0;

    sendStatus('Scanning Activity Log for posts...', 'info');
    await sleep(1500);
    debugScanPage();
    dumpAriaLabels();
    await sleep(500);

    const maxRounds = 500;
    let round = 0;
    let consecutiveFailures = 0;

    while (!stopRequested && round < maxRounds) {
      round++;

      const actionBtn = findFirstActivityActionButton();

      if (!actionBtn) {
        sendStatus(`Round ${round}: No action buttons found.`, 'warn');
        consecutiveFailures++;
        if (consecutiveFailures === 1) {
          window.scrollTo(0, 0);
          await sleep(1500);
          debugScanPage();
          dumpAriaLabels();
        } else if (consecutiveFailures >= 3) {
          sendStatus('No more posts found. All done!', 'success');
          break;
        }
        await sleep(1500);
        continue;
      }

      consecutiveFailures = 0;
      sendStatus(`Round ${round}: Clicking action button...`, 'info');
      actionBtn.click();
      await sleep(1000);

      const menu = document.querySelector('[role="menu"]');
      if (!menu) {
        sendStatus('Menu did not open.', 'warn');
        await pressEscape();
        await sleep(800);
        skippedCount++;
        continue;
      }

      // Log menu items
      const menuItemTexts = [...menu.querySelectorAll('[role="menuitem"]')]
        .map((i) => i.textContent.trim())
        .join(' | ');
      sendStatus(`Menu: ${menuItemTexts}`, 'info');

      const deleted = await clickDeleteInOpenMenu();
      if (!deleted) {
        sendStatus('No Delete in menu — skipping.', 'warn');
        await pressEscape();
        await sleep(800);
        skippedCount++;
        if (skippedCount > 10) {
          sendStatus('Too many non-deletable entries. Try filtering to Posts only.', 'error');
          break;
        }
        continue;
      }

      const confirmed = await confirmDeleteDialog();
      if (confirmed) {
        deletedCount++;
        sendStatus(`✓ Post #${deletedCount} deleted!`, 'success');
      } else {
        skippedCount++;
        sendStatus(`Skipped. Total skipped: ${skippedCount}`, 'warn');
      }

      await sleep(2200);
    }

    sendStatus(`Done! Deleted: ${deletedCount} | Skipped: ${skippedCount}`, 'success');
    isRunning = false;
  }

  // ─── Message Listener ─────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'deleteAll') {
      if (isRunning) { sendResponse({ ok: false, msg: 'Already running' }); return; }
      deleteAllPosts();
      sendResponse({ ok: true });
    }
    if (msg.action === 'stop') {
      stopRequested = true;
      isRunning = false;
      sendStatus('Stopped.', 'warn');
      sendResponse({ ok: true });
    }
    if (msg.action === 'debug') {
      debugScanPage();
      dumpAriaLabels();
      sendResponse({ ok: true });
    }
    if (msg.action === 'ping') {
      sendResponse({ ok: true, isRunning });
    }
  });

  sendStatus('FB Posts Deleter by Stacknix.dev ready.', 'success');
})();
