// Drag & Drop script for the tabs webview.
// Served as a static resource via webview.asWebviewUri().
// Only loaded when drag & drop is enabled in settings.

const DRAG_THRESHOLD = 5;   // Pixels antes de iniciar el drag
let TAB_H            = 43;  // Altura dinámica (se actualiza según modo compacto)

let isDragging         = false;
let startY             = 0;
let startMouseY        = 0;
let sourceEl           = null;  // tab DOM original (parent tab)
let sourceChildren     = [];    // child tabs attached to source (for block drag)
let cloneEl            = null;  // clon flotante
let siblings           = [];    // tabs reordenables (no pinned, excluyendo la arrastrada)
let originalOrder      = [];    // posiciones originales para calcular desplazamientos
let currentInsertIndex = -1;    // índice actual de inserción en la lista lógica
let sourceIndex        = -1;    // índice original de la tab arrastrada
let tabGroupId         = null;
let blockHeight        = 0;     // Combined height of parent + children

// --- Mousedown: preparar un posible drag ---
document.addEventListener('mousedown', e => {
  if (e.button !== 0) { return; }
  const tab = e.target.closest('.tab');
  if (!tab) { return; }
  if (e.target.closest('button')) { return; }
  if (tab.dataset.pinned === 'true') { return; }
  
  // Child tabs cannot be dragged individually - they move with their parent
  if (tab.classList.contains('child-tab')) { return; }

  sourceEl    = tab;
  startMouseY = e.clientY;
  startY      = tab.getBoundingClientRect().top;
  tabGroupId  = tab.dataset.groupid;
});

// --- Mousemove: iniciar o continuar el drag ---
document.addEventListener('mousemove', e => {
  if (!sourceEl) { return; }

  if (!isDragging) {
    if (Math.abs(e.clientY - startMouseY) < DRAG_THRESHOLD) { return; }
    beginDrag(e);
  }

  const dy = e.clientY - startMouseY;
  cloneEl.style.transform = 'translateY(' + dy + 'px)';
  
  // Move children clones with parent
  sourceChildren.forEach((child, i) => {
    const childClone = document.querySelector('.drag-clone-child-' + i);
    if (childClone) {
      childClone.style.transform = 'translateY(' + dy + 'px)';
    }
  });

  const cloneCenter = startY + (blockHeight / 2) + dy;
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

  // Find child tabs attached to this parent
  const parentTabId = sourceEl.dataset.tabid;
  sourceChildren = Array.from(document.querySelectorAll('.tab.child-tab[data-parentid="' + CSS.escape(parentTabId) + '"]'));
  
  // Calculate total block height (parent + children)
  blockHeight = TAB_H;
  sourceChildren.forEach(child => {
    blockHeight += Math.round(child.getBoundingClientRect().height) + 1;
  });

  // Get all draggable tabs (parent tabs only, not pinned, not child tabs)
  const allTabs  = Array.from(document.querySelectorAll('.tab[data-groupid="' + tabGroupId + '"]'));
  const parentTabs = allTabs.filter(t => t.dataset.pinned !== 'true' && !t.classList.contains('child-tab'));
  sourceIndex        = parentTabs.indexOf(sourceEl);
  currentInsertIndex = sourceIndex;
  siblings           = parentTabs.filter(t => t !== sourceEl);

  // Guardar posiciones originales (sus rect.top) y sus alturas (including their children)
  originalOrder = siblings.map(t => {
    const siblingRect = t.getBoundingClientRect();
    const siblingId = t.dataset.tabid;
    const siblingChildren = document.querySelectorAll('.tab.child-tab[data-parentid="' + CSS.escape(siblingId) + '"]');
    
    // Calculate total height for this sibling block
    let totalHeight = Math.round(siblingRect.height) + 1;
    siblingChildren.forEach(child => {
      totalHeight += Math.round(child.getBoundingClientRect().height) + 1;
    });
    
    return {
      el: t,
      children: Array.from(siblingChildren),
      origTop: siblingRect.top,
      height: totalHeight,
    };
  });

  // Crear clon flotante para parent
  cloneEl     = sourceEl.cloneNode(true);
  cloneEl.classList.add('drag-clone');
  cloneEl.style.top    = rect.top    + 'px';
  cloneEl.style.left   = rect.left   + 'px';
  cloneEl.style.width  = rect.width  + 'px';
  cloneEl.style.height = rect.height + 'px';
  document.body.appendChild(cloneEl);

  // Create clones for children
  let childTop = rect.top + rect.height;
  sourceChildren.forEach((child, i) => {
    const childRect = child.getBoundingClientRect();
    const childClone = child.cloneNode(true);
    childClone.classList.add('drag-clone', 'drag-clone-child-' + i);
    childClone.style.top    = childTop + 'px';
    childClone.style.left   = childRect.left + 'px';
    childClone.style.width  = childRect.width + 'px';
    childClone.style.height = childRect.height + 'px';
    document.body.appendChild(childClone);
    childTop += childRect.height;
    
    child.classList.add('drag-placeholder');
  });

  sourceEl.classList.add('drag-placeholder');
  
  // Mark all parent siblings and their children as shifting
  siblings.forEach(t => {
    t.classList.add('drag-shifting');
    const sibId = t.dataset.tabid;
    document.querySelectorAll('.tab.child-tab[data-parentid="' + CSS.escape(sibId) + '"]').forEach(c => {
      c.classList.add('drag-shifting');
    });
  });
}

function updateSiblingPositions(cloneCenter) {
  let newIndex = siblings.length; // por defecto al final

  for (let i = 0; i < originalOrder.length; i++) {
    if (cloneCenter < originalOrder[i].origTop + (originalOrder[i].height / 2)) {
      newIndex = i;
      break;
    }
  }

  if (newIndex === currentInsertIndex) { return; }
  currentInsertIndex = newIndex;

  for (let i = 0; i < originalOrder.length; i++) {
    const s           = originalOrder[i];
    const origLogical = (i < sourceIndex) ? i : i + 1;
    let   shift       = 0;

    // Use blockHeight instead of single tab height for shift calculation
    if      (origLogical < sourceIndex && i >= currentInsertIndex) { shift =  blockHeight; }
    else if (origLogical > sourceIndex && i <  currentInsertIndex) { shift = -blockHeight; }

    // Apply transform to parent and all its children
    const transform = shift ? ('translateY(' + shift + 'px)') : '';
    s.el.style.transform = transform;
    s.children.forEach(child => {
      child.style.transform = transform;
    });
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
  // Remove parent clone
  if (cloneEl) { cloneEl.remove(); cloneEl = null; }
  
  // Remove all child clones
  document.querySelectorAll('.drag-clone').forEach(el => el.remove());
  
  // Clean up source parent
  if (sourceEl) { 
    sourceEl.classList.remove('drag-placeholder'); 
    sourceEl = null; 
  }
  
  // Clean up source children
  sourceChildren.forEach(child => {
    child.classList.remove('drag-placeholder');
    child.style.transform = '';
  });
  sourceChildren = [];
  
  // Clean up siblings and their children
  siblings.forEach(t => { 
    t.classList.remove('drag-shifting'); 
    t.style.transform = ''; 
  });
  originalOrder.forEach(s => {
    s.children.forEach(child => {
      child.classList.remove('drag-shifting');
      child.style.transform = '';
    });
  });
  
  document.body.classList.remove('drag-active');
  isDragging         = false;
  siblings           = [];
  originalOrder      = [];
  currentInsertIndex = -1;
  sourceIndex        = -1;
  blockHeight        = 0;
}
