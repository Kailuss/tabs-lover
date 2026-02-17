import * as vscode from 'vscode';
import { TabIconManager } from '../services/TabIconManager';
import { SideTab }        from '../models/SideTab';
import { SideTabGroup }   from '../models/SideTabGroup';

/**
 * Builder encargado de generar el HTML/CSS del webview de tabs.
 * Separado del provider para mantener responsabilidades claras y facilitar testing.
 */
export class TabsLoverHtmlBuilder {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly iconManager: TabIconManager,
    private readonly context: vscode.ExtensionContext,
  ) {}

  /**
   * Construye el HTML completo del webview incluyendo CSS y JavaScript.
   */
  async buildHtml(
    webview: vscode.Webview,
    groups: SideTabGroup[],
    getTabsInGroup: (groupId: number) => SideTab[],
    tabHeight: number,
    showPath: boolean,
    copilotReady: boolean,
    enableDragDrop: boolean = false,
  ): Promise<string> {
    // Get CSS URIs
    const codiconCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
    );
    const webviewCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'styles', 'webview.css')
    );

    let tabsHtml = '';

    if (groups.length <= 1) {
      const groupId = groups[0]?.id;
      if (groupId !== undefined) {
        tabsHtml = await this.renderTabList(getTabsInGroup(groupId), tabHeight, showPath, copilotReady, enableDragDrop);
      }
    } else {
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const tabs = getTabsInGroup(group.id);
        tabsHtml += this.renderGroupHeader(group);
        tabsHtml += await this.renderTabList(tabs, tabHeight, showPath, copilotReady, enableDragDrop);
      }
    }

    const dragDropScript = enableDragDrop ? this.getDragDropScript() : '';

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<link href="${codiconCssUri}" rel="stylesheet" />
<link href="${webviewCssUri}" rel="stylesheet" />
</head>
<body>
  ${tabsHtml || '<div class="empty">No open tabs</div>'}
  <script>
    const vscode = acquireVsCodeApi();

    // Flag para evitar mensajes duplicados durante animación
    const closingTabs = new Set();

    document.addEventListener('click', e => {
      const btn = e.target.closest('button[data-action]');
      if (btn) {
        e.stopPropagation();
        
        // Manejar closeTab con animación
        if (btn.dataset.action === 'closeTab') {
          const tabId = btn.dataset.tabid;
          const tab = document.querySelector(\`.tab[data-tabid="\${tabId}"]\`);
          
          if (tab && !closingTabs.has(tabId)) {
            closingTabs.add(tabId);
            tab.classList.add('closing');
            
            // Esperar a que termine la animación antes de enviar el mensaje
            setTimeout(() => {
              vscode.postMessage({ type: 'closeTab', tabId: tabId });
              closingTabs.delete(tabId);
            }, 200); // Duración de la animación
          }
          return;
        }
        
        vscode.postMessage({ type: btn.dataset.action, tabId: btn.dataset.tabid });
        return;
      }
      const tab = e.target.closest('.tab');
      if (tab) {
        vscode.postMessage({ type: 'openTab', tabId: tab.dataset.tabid });
      }
    });

    document.addEventListener('contextmenu', e => {
      const tab = e.target.closest('.tab');
      if (tab) {
        e.preventDefault();
        vscode.postMessage({ type: 'contextMenu', tabId: tab.dataset.tabid });
      }
    });

    ${dragDropScript}
  </script>
</body>
</html>`;
  }

  private renderGroupHeader(group: SideTabGroup): string {
    const marker = group.isActive ? ' ● Active' : '';
    return `<div class="group-header">
      <span class="codicon codicon-window"></span>
      <span>${this.esc(group.label)}${marker}</span>
    </div>`;
  }

  private async renderTabList(
    tabs: SideTab[],
    tabHeight: number,
    showPath: boolean,
    copilotReady: boolean,
    enableDragDrop: boolean = false,
  ): Promise<string> {
    // Ensure pinned tabs appear first, preserving relative order within each section
    const sorted = [...tabs].sort((a, b) => {
      if (a.state.isPinned && !b.state.isPinned) { return -1; }
      if (!a.state.isPinned && b.state.isPinned) { return  1; }
      return 0; // stable sort keeps original order within pinned / unpinned
    });

    const rendered = await Promise.all(
      sorted.map(t => this.renderTab(t, tabHeight, showPath, copilotReady, enableDragDrop))
    );
    return rendered.join('');
  }

  private async renderTab(
    tab: SideTab,
    _tabHeight: number,
    showPath: boolean,
    copilotReady: boolean,
    enableDragDrop: boolean = false,
  ): Promise<string> {
    const activeClass = tab.state.isActive ? ' active' : '';
    
    // Drag & drop attributes
    const dataPinned = `data-pinned="${tab.state.isPinned}"`;
    const dataGroupId = `data-groupid="${tab.state.groupId}"`;

    // Estado visual del archivo (modificado)
    const dirtyDot = tab.state.isDirty
      ? '<span class="tab-state" title="Modified"><span class="codicon codicon-close-dirty"></span></span>'
      : '<span class="tab-state clean"></span>';

    // Determinar clase de estado para el nombre del archivo
    // Prioridad: diagnostics > git status > dirty
    let stateClass = '';
    if (tab.state.diagnosticSeverity === 0) {  // Error
      stateClass = ' error';
    } else if (tab.state.diagnosticSeverity === 1) {  // Warning
      stateClass = ' warning';
    } else if (tab.state.gitStatus) {
      stateClass = ` ${tab.state.gitStatus}`;
    } else if (tab.state.isDirty) {
      stateClass = ' modified';
    }

    const stateStyle = '';  // Las clases CSS ya tienen los colores definidos

    // Badge de pinned junto al nombre
    const pinBadge = tab.state.isPinned ? '<span class="pin-badge codicon codicon-pinned" title="Pinned"></span>' : '';

    // Botones de acción
    const pinBtn = tab.state.isPinned
      ? `<button data-action="unpinTab" data-tabid="${this.esc(tab.metadata.id)}" title="Unpin"><span class="codicon codicon-pin"></span></button>`
      : `<button data-action="pinTab"   data-tabid="${this.esc(tab.metadata.id)}" title="Pin"><span class="codicon codicon-pinned"></span></button>`;

    const chatBtn = copilotReady && tab.metadata.uri
      ? `<button data-action="addToChat" data-tabid="${this.esc(tab.metadata.id)}" title="Add to Copilot Chat"><span class="codicon codicon-attach"></span></button>`
      : '';

    const closeBtn = `<button data-action="closeTab" data-tabid="${this.esc(tab.metadata.id)}" title="Close"><span class="codicon codicon-remove-close"></span></button>`;

    const pathHtml = showPath && tab.metadata.description
      ? `<div class="tab-path">${this.esc(tab.metadata.description)}</div>`
      : '';

    const iconHtml = await this.getIconHtml(tab);

    return `<div class="tab${activeClass}" data-tabid="${this.esc(tab.metadata.id)}" ${dataPinned} ${dataGroupId}>
      <span class="tab-icon">${iconHtml}</span>
      <div class="tab-text">
        <div class="tab-name${stateClass}">${this.esc(tab.metadata.label)}${pinBadge}</div>
        ${pathHtml}
      </div>
      ${dirtyDot}
      <span class="tab-actions">
        ${pinBtn}${chatBtn}${closeBtn}
      </span>
    </div>`;
  }

  /** Escapa caracteres especiales para insertar texto de forma segura en HTML. */
  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Codicon names for built-in webview / unknown-input tabs. */
  private static readonly BUILTIN_ICON_MAP: Record<string, string> = {
    // By viewType (webview / custom editor tabs)
    'releaseNotes':                        'info',
    'simpleBrowser.view':                  'globe',
    'markdown.preview':                    'open-preview',
    'vscode.markdown.preview.editor':      'open-preview',
    'mainThreadWebview-markdown.preview':   'open-preview',
    // By label (unknown-input built-in editors)
    'Settings':                            'settings-gear',
    'Keyboard Shortcuts':                  'keyboard',
    'Welcome':                             'star-empty',
    'Getting Started':                     'star-empty',
    'Editor Playground':                   'education',
    'Running Extensions':                  'extensions',
    'Process Explorer':                    'server-process',
    'Language Models':                     'hubot',
  };

  /** Label prefixes for built-in tabs whose title is dynamic. */
  private static readonly BUILTIN_PREFIX_MAP: [string, string][] = [
    ['Extension:',      'extensions'],
    ['Walkthrough:',    'star-empty'],
    ['Release Notes:',  'info'],
    ['Preview ',        'open-preview'],
    ['[Preview] ',      'open-preview'],
  ];

  /**
   * Obtiene el HTML del icono para un tab.
   * - Tabs de archivo / diff: icono del tema activo (base64).
   * - Tabs webview / unknown: codicon correspondiente al tipo de editor.
   */
  private async getIconHtml(tab: SideTab): Promise<string> {
    const { tabType, viewType, label, uri } = tab.metadata;

    // Non-file tabs: resolve a codicon instead of a file-theme icon
    if (tabType === 'webview' || tabType === 'unknown') {
      const codicon = this.resolveBuiltInCodicon(label, viewType);
      return `<span class="codicon codicon-${codicon}"></span>`;
    }

    // For diff tabs, resolve the icon from the underlying file name (strip the URI basename)
    const fileName = tabType === 'diff' && uri
      ? uri.path.split('/').pop() || label
      : label;

    if (!fileName) {
      return this.getFallbackIcon();
    }

    try {
      // Try cached icon first (synchronous, no I/O)
      const cached = this.iconManager.getCachedIcon(fileName);
      if (cached) {
        return `<img src="${cached}" alt="" />`;
      }

      // Resolver desde el tema de iconos (async — lee disco una sola vez y cachea)
      const base64 = await this.iconManager.getFileIconAsBase64(
        fileName,
        this.context,
      );

      if (base64) {
        return `<img src="${base64}" alt="" />`;
      }
    } catch (error) {
      console.warn(`[TabsLover] Icon resolution failed for ${fileName}:`, error);
    }

    return this.getFallbackIcon();
  }

  /**
   * Resolves a codicon name for a built-in (non-file) tab.
   * Tries viewType first, then exact label, then label prefix.
   */
  private resolveBuiltInCodicon(label: string, viewType?: string): string {
    // 1. Match by viewType
    if (viewType) {
      const byView = TabsLoverHtmlBuilder.BUILTIN_ICON_MAP[viewType];
      if (byView) { return byView; }
    }

    // 2. Match by exact label
    const byLabel = TabsLoverHtmlBuilder.BUILTIN_ICON_MAP[label];
    if (byLabel) { return byLabel; }

    // 3. Match by label prefix
    for (const [prefix, icon] of TabsLoverHtmlBuilder.BUILTIN_PREFIX_MAP) {
      if (label.startsWith(prefix)) { return icon; }
    }

    // 4. Generic fallback
    return 'preview';
  }

  private getFallbackIcon(): string {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg">
      <path d="M3 1h7l3 3v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"
        stroke="currentColor" stroke-width="1" fill="none"/>
      <path d="M10 1v3h3" stroke="currentColor" stroke-width="1" fill="none"/>
    </svg>`;
  }

  /**
   * Genera el script de drag & drop basado en mouse events.
   * La tab arrastrada se mueve verticalmente con el cursor como clon flotante,
   * mientras las demás tabs se desplazan con animaciones CSS para adaptarse
   * al nuevo orden dinámicamente.
   */
  private getDragDropScript(): string {
    return `
    // === Drag & Drop via Mouse Events ===
    const TAB_H      = 43;   // Altura de cada tab incluyendo border (px)
    const DRAG_THRESHOLD = 5; // Pixels antes de iniciar el drag

    let isDragging   = false;
    let startY       = 0;
    let startMouseY  = 0;
    let sourceEl     = null;  // tab DOM original
    let cloneEl      = null;  // clon flotante
    let siblings     = [];    // tabs reordenables (no pinned, excluyendo la arrastrada)
    let originalOrder = [];   // posiciones originales para calcular desplazamientos
    let currentInsertIndex = -1; // índice actual de inserción en la lista lógica
    let sourceIndex  = -1;    // índice original de la tab arrastrada
    let tabGroupId   = null;

    // --- Mousedown: preparar un posible drag ---
    document.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const tab = e.target.closest('.tab');
      if (!tab) return;
      if (e.target.closest('button')) return;
      if (tab.dataset.pinned === 'true') return;

      sourceEl    = tab;
      startMouseY = e.clientY;
      startY      = tab.getBoundingClientRect().top;
      tabGroupId  = tab.dataset.groupid;
    });

    // --- Mousemove: iniciar o continuar el drag ---
    document.addEventListener('mousemove', e => {
      if (!sourceEl) return;

      if (!isDragging) {
        if (Math.abs(e.clientY - startMouseY) < DRAG_THRESHOLD) return;
        beginDrag(e);
      }

      // Mover el clon con el cursor
      const dy = e.clientY - startMouseY;
      cloneEl.style.transform = 'translateY(' + dy + 'px)';

      // Calcular en qué posición cae el centro del clon
      const cloneCenter = startY + (TAB_H / 2) + dy;
      updateSiblingPositions(cloneCenter);
    });

    // --- Mouseup: terminar el drag ---
    document.addEventListener('mouseup', e => {
      if (!sourceEl) return;
      if (!isDragging) { sourceEl = null; return; }
      commitDrop();
    });

    // --- Cancelar si se sale de la ventana ---
    document.addEventListener('mouseleave', e => {
      if (isDragging) cancelDrag();
    });

    // ------------ helpers ------------

    function beginDrag(e) {
      isDragging = true;
      document.body.classList.add('drag-active');

      // Recolectar tabs no-pinned del mismo grupo
      const allTabs = Array.from(
        document.querySelectorAll('.tab[data-groupid="' + tabGroupId + '"]')
      );

      const unpinned = allTabs.filter(t => t.dataset.pinned !== 'true');
      sourceIndex = unpinned.indexOf(sourceEl);
      currentInsertIndex = sourceIndex;

      siblings = unpinned.filter(t => t !== sourceEl);

      // Guardar posiciones originales (sus rect.top)
      originalOrder = siblings.map(t => ({
        el: t,
        origTop: t.getBoundingClientRect().top,
      }));

      // Crear clon flotante
      const rect = sourceEl.getBoundingClientRect();
      cloneEl = sourceEl.cloneNode(true);
      cloneEl.classList.add('drag-clone');
      cloneEl.style.top    = rect.top + 'px';
      cloneEl.style.left   = rect.left + 'px';
      cloneEl.style.width  = rect.width + 'px';
      cloneEl.style.height = rect.height + 'px';
      document.body.appendChild(cloneEl);

      // Ocultar la original (placeholder)
      sourceEl.classList.add('drag-placeholder');

      // Habilitar transiciones en siblings
      siblings.forEach(t => t.classList.add('drag-shifting'));
    }

    function updateSiblingPositions(cloneCenter) {
      // Calcular nuevo índice basado en posiciones ORIGINALES
      // (no las animadas, para evitar interferencias)
      let newIndex = siblings.length; // por defecto al final

      for (let i = 0; i < originalOrder.length; i++) {
        const midpoint = originalOrder[i].origTop + (TAB_H / 2);
        if (cloneCenter < midpoint) {
          newIndex = i;
          break;
        }
      }

      if (newIndex === currentInsertIndex) return;
      currentInsertIndex = newIndex;

      // Aplicar desplazamientos: las tabs se mueven para hacer hueco
      for (let i = 0; i < originalOrder.length; i++) {
        const s = originalOrder[i];
        let shift = 0;

        // Posición lógica original de esta sibling en unpinned completo
        const origLogical = (i < sourceIndex) ? i : i + 1;

        if (origLogical < sourceIndex && i >= currentInsertIndex) {
          shift = TAB_H;
        } else if (origLogical > sourceIndex && i < currentInsertIndex) {
          shift = -TAB_H;
        }

        s.el.style.transform = shift ? ('translateY(' + shift + 'px)') : '';
      }
    }

    function commitDrop() {
      // Solo enviar mensaje si realmente cambió la posición
      if (currentInsertIndex !== sourceIndex) {
        const order = siblings.map(s => s);

        let targetTabId, insertPosition;
        if (currentInsertIndex < order.length) {
          targetTabId = order[currentInsertIndex].dataset.tabid;
          insertPosition = 'before';
        } else {
          targetTabId = order[order.length - 1].dataset.tabid;
          insertPosition = 'after';
        }

        vscode.postMessage({
          type: 'dropTab',
          sourceTabId: sourceEl.dataset.tabid,
          targetTabId: targetTabId,
          insertPosition: insertPosition,
          sourceGroupId: parseInt(tabGroupId, 10),
          targetGroupId: parseInt(tabGroupId, 10),
        });
      }

      teardown();
    }

    function cancelDrag() {
      teardown();
    }

    function teardown() {
      if (cloneEl) { cloneEl.remove(); cloneEl = null; }
      if (sourceEl) {
        sourceEl.classList.remove('drag-placeholder');
        sourceEl = null;
      }
      siblings.forEach(t => {
        t.classList.remove('drag-shifting');
        t.style.transform = '';
      });
      document.body.classList.remove('drag-active');
      isDragging       = false;
      siblings         = [];
      originalOrder    = [];
      currentInsertIndex = -1;
      sourceIndex      = -1;
    }
    `;
  }
}