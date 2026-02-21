// Drag & Drop script for the tabs webview.
// Served as a static resource via webview.asWebviewUri().
// Only loaded when drag & drop is enabled in settings.

const DRAG_THRESHOLD = 5;   // Pixels antes de iniciar el drag
let TAB_H            = 43;  // Altura dinámica (se actualiza según modo compacto)

let isDragging         = false;
let startY             = 0;
let startMouseY        = 0;
let sourceEl           = null;  // tab DOM original
let cloneEl            = null;  // clon flotante
let siblings           = [];    // tabs reordenables (no pinned, excluyendo la arrastrada)
let originalOrder      = [];    // posiciones originales para calcular desplazamientos
let currentInsertIndex = -1;    // índice actual de inserción en la lista lógica
let sourceIndex        = -1;    // índice original de la tab arrastrada
let tabGroupId         = null;

// --- Mousedown: preparar un posible drag ---
document.addEventListener('mousedown', e => {
  if (e.button !== 0) {return;}
  const tab = e.target.closest('.tab');
  if (!tab) {return;}
  if (e.target.closest('button')) {return;}
  if (tab.dataset.pinned === 'true') {return;}

  sourceEl    = tab;
  startMouseY = e.clientY;
  startY      = tab.getBoundingClientRect().top;
  tabGroupId  = tab.dataset.groupid;
});

// --- Mousemove: iniciar o continuar el drag ---
document.addEventListener('mousemove', e => {
  if (!sourceEl) {return;}

  if (!isDragging) {
    if (Math.abs(e.clientY - startMouseY) < DRAG_THRESHOLD) {return;}
    beginDrag(e);
  }

  const dy = e.clientY - startMouseY;
  cloneEl.style.transform = 'translateY(' + dy + 'px)';

  const cloneCenter = startY + (TAB_H / 2) + dy;
  updateSiblingPositions(cloneCenter);
});

// --- Mouseup: terminar el drag ---
document.addEventListener('mouseup', () => {
  if (!sourceEl) {return;}
  if (!isDragging) { sourceEl = null; return; }
  commitDrop();
});

// --- Cancelar si se sale de la ventana ---
document.addEventListener('mouseleave', () => {
  if (isDragging) {cancelDrag();}
});

// ------------ helpers ------------

function beginDrag() {
  isDragging = true;
  document.body.classList.add('drag-active');

  // Detectar altura real de la tab (compacto: 26px, normal: 42px) + 1px de border
  const rect = sourceEl.getBoundingClientRect();
  TAB_H = Math.round(rect.height) + 1;

  const allTabs  = Array.from(document.querySelectorAll('.tab[data-groupid="' + tabGroupId + '"]'));
  const unpinned = allTabs.filter(t => t.dataset.pinned !== 'true');
  sourceIndex        = unpinned.indexOf(sourceEl);
  currentInsertIndex = sourceIndex;
  siblings           = unpinned.filter(t => t !== sourceEl);

  // Guardar posiciones originales (sus rect.top) y sus alturas
  originalOrder = siblings.map(t => {
    const siblingRect = t.getBoundingClientRect();
    return {
      el: t,
      origTop: siblingRect.top,
      height: Math.round(siblingRect.height) + 1, // altura real + border
    };
  });

  // Crear clon flotante
  cloneEl     = sourceEl.cloneNode(true);
  cloneEl.classList.add('drag-clone');
  cloneEl.style.top    = rect.top    + 'px';
  cloneEl.style.left   = rect.left   + 'px';
  cloneEl.style.width  = rect.width  + 'px';
  cloneEl.style.height = rect.height + 'px';
  document.body.appendChild(cloneEl);

  sourceEl.classList.add('drag-placeholder');
  siblings.forEach(t => t.classList.add('drag-shifting'));
}

function updateSiblingPositions(cloneCenter) {
  let newIndex = siblings.length; // por defecto al final

  for (let i = 0; i < originalOrder.length; i++) {
    if (cloneCenter < originalOrder[i].origTop + (originalOrder[i].height / 2)) {
      newIndex = i;
      break;
    }
  }

  if (newIndex === currentInsertIndex) {return;}
  currentInsertIndex = newIndex;

  for (let i = 0; i < originalOrder.length; i++) {
    const s           = originalOrder[i];
    const origLogical = (i < sourceIndex) ? i : i + 1;
    let   shift       = 0;

    if      (origLogical < sourceIndex && i >= currentInsertIndex) { shift =  s.height -1; }
    else if (origLogical > sourceIndex && i <  currentInsertIndex) { shift = -s.height +1; }

    s.el.style.transform = shift ? ('translateY(' + shift + 'px)') : '';
  }
}

function commitDrop() {
  if (currentInsertIndex !== sourceIndex) {
    const order = siblings.map(s => s);

    let targetTabId, insertPosition;
    if (currentInsertIndex < order.length) {
      targetTabId    = order[currentInsertIndex].dataset.tabid;
      insertPosition = 'before';
    } else {
      targetTabId    = order[order.length - 1].dataset.tabid;
      insertPosition = 'after';
    }

    // Enviar el mensaje PRIMERO para que el rebuild del HTML empiece ya
    vscode.postMessage({
      type           : 'dropTab',
      sourceTabId    : sourceEl.dataset.tabid,
      targetTabId    : targetTabId,
      insertPosition : insertPosition,
      sourceGroupId  : parseInt(tabGroupId, 10),
      targetGroupId  : parseInt(tabGroupId, 10),
    });

    // Animar el clon hasta su slot final como puente visual
    const finalDy = (currentInsertIndex - sourceIndex) * TAB_H;
    cloneEl.style.transition = 'transform 150ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity 150ms ease-out';
    cloneEl.style.transform  = 'translateY(' + finalDy + 'px)';
    cloneEl.style.opacity    = '0';
    setTimeout(() => teardown(), 160);

  } else {
    // Sin cambio de posición — volver al origen con fade-out
    cloneEl.style.transition = 'transform 150ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity 120ms ease-out';
    cloneEl.style.transform  = 'translateY(0)';
    cloneEl.style.opacity    = '0';
    setTimeout(() => teardown(), 160);
  }
}

function cancelDrag() { teardown(); }

function teardown() {
  if (cloneEl)  { cloneEl.remove(); cloneEl = null; }
  if (sourceEl) { sourceEl.classList.remove('drag-placeholder'); sourceEl = null; }
  siblings.forEach(t => { t.classList.remove('drag-shifting'); t.style.transform = ''; });
  document.body.classList.remove('drag-active');
  isDragging         = false;
  siblings           = [];
  originalOrder      = [];
  currentInsertIndex = -1;
  sourceIndex        = -1;
}
