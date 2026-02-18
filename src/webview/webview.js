// Main webview interaction script.
// Handles clicks, context menu and partial active-state updates from the host.
// Served as a static resource via webview.asWebviewUri().

const vscode = acquireVsCodeApi();

// Evitar mensajes duplicados durante la animación de cierre
const closingTabs = new Set();

document.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (btn) {
    e.stopPropagation();

    if (btn.dataset.action === 'closeTab') {
      const tabId = btn.dataset.tabid;
      const tab   = document.querySelector(`.tab[data-tabid="${tabId}"]`);
      if (tab && !closingTabs.has(tabId)) {
        closingTabs.add(tabId);
        tab.classList.add('closing');
        setTimeout(() => {
          vscode.postMessage({ type: 'closeTab', tabId });
          closingTabs.delete(tabId);
        }, 200);
      }
      return;
    }

    if (btn.dataset.action === 'fileAction') {
      vscode.postMessage({ type: 'fileAction', tabId: btn.dataset.tabid, actionId: btn.dataset.actionid });
      return;
    }

    vscode.postMessage({ type: btn.dataset.action, tabId: btn.dataset.tabid });
    return;
  }

  const tab = e.target.closest('.tab');
  if (tab) { vscode.postMessage({ type: 'openTab', tabId: tab.dataset.tabid }); }
});

document.addEventListener('contextmenu', e => {
  const tab = e.target.closest('.tab');
  if (tab) {
    e.preventDefault();
    vscode.postMessage({ type: 'contextMenu', tabId: tab.dataset.tabid });
  }
});

// Actualización parcial desde el host (evita rebuild completo al cambiar tab activa)
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'updateActiveTab') {
    const activeSet = new Set(msg.activeTabIds);
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', activeSet.has(t.dataset.tabid));
    });
  }
});
