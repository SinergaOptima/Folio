import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { check } from '@tauri-apps/plugin-updater';

/* ── State ── */
let items = [];
let idx = 0;
let zoom = 1;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

/* ── DOM ── */
const app = document.getElementById('app');
app.innerHTML = `
  <div class="welcome" id="welcome">
    <div class="welcome-dragbar" id="wDrag" data-tauri-drag-region></div>
    <div class="welcome-bg" id="welcomeBg">
      <div class="welcome-bg-inner"></div>
    </div>
    <div class="welcome-content">
      <h1>Folio</h1>
      <p class="tagline">Your photography, undistracted.</p>
      <button class="welcome-btn" id="openBtn"><span>Open Folder</span></button>
      <div class="welcome-shortcuts">
        <span><kbd>⇧</kbd> + Scroll to Zoom</span>
        <span><kbd>⇧</kbd> + Mid Click to Pan</span>
        <span>Drag to Move Window</span>
      </div>
    </div>
  </div>

  <div class="sidebar" id="sidebar" style="display:none">
    <div class="sidebar-dragbar" id="sDrag" data-tauri-drag-region>
      <span class="folder-name" id="folderLabel"></span>
    </div>
    <div class="sidebar-controls">
      <button class="sidebar-btn" id="openBtn2"><span class="icon">📂</span> Open Folder</button>
    </div>
    <div class="sidebar-divider"></div>
    <div class="sidebar-info">
      <div class="counter" id="counter"></div>
      <div class="filename" id="fname"></div>
      <div class="dimensions" id="dims"></div>
      <span class="format-badge" id="badge" style="display:none"></span>
    </div>
    <div class="sidebar-divider"></div>
    <div class="filmstrip" id="filmstrip"></div>
    <div class="sidebar-resizer" id="sidebarResizer"></div>
  </div>

  <div class="viewer" id="viewer" style="display:none">
    <div class="viewer-bg-base"></div>
    <div class="dynamic-bg-tint" id="bgTint"></div>
    <div class="viewer-dragbar" id="vDrag" data-tauri-drag-region></div>
    <button class="sidebar-toggle" id="sidebarToggle" title="Toggle Sidebar">Sidebar</button>
    <div class="media-wrap" id="media">
      <div class="media-loader" id="mediaLoader" aria-hidden="true">
        <svg class="loader-ring" viewBox="0 0 44 44">
          <circle class="loader-track" cx="22" cy="22" r="18"></circle>
          <circle class="loader-indicator" cx="22" cy="22" r="18"></circle>
        </svg>
      </div>
    </div>
    
    <div class="editorial-overlay" id="editorialOverlay">
      <div class="editorial-camera" id="edCamera"></div>
      <div class="editorial-stats">
        <div class="editorial-stat-group"><span class="editorial-stat-label">Aperture</span><span class="editorial-stat-value" id="edAperture">—</span></div>
        <div class="editorial-stat-group"><span class="editorial-stat-label">Shutter</span><span class="editorial-stat-value" id="edShutter">—</span></div>
        <div class="editorial-stat-group"><span class="editorial-stat-label">ISO</span><span class="editorial-stat-value" id="edIso">—</span></div>
        <div class="editorial-stat-group"><span class="editorial-stat-label">Focal</span><span class="editorial-stat-value" id="edFocal">—</span></div>
      </div>
    </div>
    <button class="nav-arrow prev" id="prev">‹</button>
    <button class="nav-arrow next" id="next">›</button>
    <div class="zoom-hud" id="zoomHud">
      <input type="range" id="zoomSlider" min="100" max="800" value="100" step="10" />
      <span class="zoom-label" id="zoomLabel">100%</span>
      <button class="zoom-reset" id="zoomReset">FIT</button>
      <button class="zoom-action fullscreen-toggle" id="fullscreenBtn" title="Enter Fullscreen">FULL</button>
    </div>
  </div>

  <div class="image-fullscreen" id="imageFullscreen" aria-hidden="true">
    <div class="image-fullscreen-bg"></div>
    <div class="image-fullscreen-ui">
      <button class="image-fullscreen-exit" id="imageFsExit">Exit</button>
      <div class="image-fullscreen-hint" id="imageFsHint">Shift + F to exit</div>
    </div>
  </div>

  <div class="settings-modal" id="settingsModal" style="display:none">
    <div class="settings-bg" id="settingsBg"></div>
    <div class="settings-content">
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="settings-close" id="settingsClose">×</button>
      </div>
      <div class="settings-body">
        <div class="settings-tabs">
          <button class="tab-btn active" data-tab="general">General</button>
          <button class="tab-btn" data-tab="appearance">Appearance</button>
          <button class="tab-btn" data-tab="keybinds">Keybinds</button>
        </div>

        <div class="tab-pane active" id="tab-general">
          <div class="setting-row">
            <label for="sortSelect">Sort By</label>
            <select id="sortSelect">
              <option value="name">Name</option>
              <option value="date">Date</option>
              <option value="size">Size</option>
            </select>
          </div>
          <div class="setting-row">
            <label for="zoomSensSlider">Zoom Sensitivity</label>
            <input type="range" id="zoomSensSlider" min="1" max="10" value="5" />
          </div>
          <div class="sidebar-divider" style="margin: 4px 0"></div>
          <div class="setting-row">
            <label for="autoUpdateCheck">Check for updates on startup</label>
            <input type="checkbox" id="autoUpdateCheck" checked />
          </div>
          <div class="setting-row">
            <label>Updates</label>
            <button class="settings-update-btn" id="checkUpdateBtn">Check Now</button>
          </div>
        </div>

        <div class="tab-pane" id="tab-appearance">
          <div class="setting-row">
            <label for="themeSelect">Theme</label>
            <select id="themeSelect">
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <div class="setting-row">
            <label for="customCursorCheck">Use Custom Cursor</label>
            <input type="checkbox" id="customCursorCheck" checked />
          </div>
          <div class="setting-row">
            <label for="cinematicCheck">Enable Cinematic Transitions</label>
            <input type="checkbox" id="cinematicCheck" checked />
          </div>
        </div>

        <div class="tab-pane" id="tab-keybinds">
          <div class="setting-row">
            <label style="font-size: 0.85rem; color: var(--text-primary); font-weight: 500;">Keybindings</label>
            <button class="settings-update-btn" id="resetKeybindsBtn">Reset Defaults</button>
          </div>
          <div class="setting-row">
            <label>Next Image</label>
            <button class="keybind-btn" data-action="nextImage"></button>
          </div>
          <div class="setting-row">
            <label>Previous Image</label>
            <button class="keybind-btn" data-action="prevImage"></button>
          </div>
          <div class="setting-row">
            <label>Reset Zoom</label>
            <button class="keybind-btn" data-action="resetZoom"></button>
          </div>
          <div class="setting-row">
            <label>Toggle Metadata</label>
            <button class="keybind-btn" data-action="toggleMetadata"></button>
          </div>
          <div class="setting-row">
            <label>Play/Pause Video</label>
            <button class="keybind-btn" data-action="playVideo"></button>
          </div>
          <div class="setting-row">
            <label>Zoom Modifier (Scroll)</label>
            <button class="keybind-btn" data-action="modifierZoom"></button>
          </div>
          <div class="setting-row">
            <label>Pan Modifier (Middle Click)</label>
            <button class="keybind-btn" data-action="modifierPan"></button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="update-bar" id="updateBar" style="display:none">
    <span class="update-text" id="updateText"></span>
    <button class="update-action" id="updateAction">Update</button>
    <button class="update-dismiss" id="updateDismiss">×</button>
  </div>

  <div class="custom-cursor" id="customCursor"></div>
  <div id="toastContainer" class="toast-container"></div>
`;

const $ = id => document.getElementById(id);
const welcome   = $('welcome');
const welcomeBg = $('welcomeBg');
const sidebar   = $('sidebar');
const sidebarResizer = $('sidebarResizer');
const sidebarToggle  = $('sidebarToggle');
const viewer    = $('viewer');
const filmstrip = $('filmstrip');
const media     = $('media');
const mediaLoader = $('mediaLoader');
const counter   = $('counter');
const fname     = $('fname');
const dims      = $('dims');
const badge     = $('badge');
const folderLabel = $('folderLabel');
const zoomSlider  = $('zoomSlider');
const zoomLabel   = $('zoomLabel');
const fullscreenBtn = $('fullscreenBtn');
const imageFullscreen = $('imageFullscreen');
const imageFsExit = $('imageFsExit');
const imageFsHint = $('imageFsHint');

/* ── Settings Logic ── */
let currentSort = localStorage.getItem('folio_sort') || 'name';
let zoomSens = parseFloat(localStorage.getItem('folio_zoom_sens')) || 5;
let currentTheme = localStorage.getItem('folio_theme') || 'dark';
let cinematicEnabled = localStorage.getItem('folio_cinematic') !== 'false';

const defaultKeybinds = {
  nextImage: 'ArrowRight',
  prevImage: 'ArrowLeft',
  resetZoom: '0',
  toggleMetadata: 'i',
  playVideo: ' ',
  modifierZoom: 'Shift',
  modifierPan: 'Shift'
};
let keybinds = { ...defaultKeybinds, ...JSON.parse(localStorage.getItem('folio_keybinds') || '{}') };

const sortSelect = $('sortSelect');
const zoomSensSlider = $('zoomSensSlider');
const themeSelect = $('themeSelect');
const cinematicCheck = $('cinematicCheck');

sortSelect.value = currentSort;
zoomSensSlider.value = zoomSens;
themeSelect.value = currentTheme;
if (cinematicCheck) cinematicCheck.checked = cinematicEnabled;

function applyTheme(theme) {
  const root = document.documentElement.style;
  if (theme === 'light') {
    root.setProperty('--bg-deep', '#f4f4f5');
    root.setProperty('--bg-sidebar', 'rgba(250, 250, 250, 0.92)');
    root.setProperty('--text-primary', '#18181b');
    root.setProperty('--text-secondary', 'rgba(0, 0, 0, 0.6)');
    root.setProperty('--text-tertiary', 'rgba(0, 0, 0, 0.4)');
    root.setProperty('--border-subtle', 'rgba(0, 0, 0, 0.08)');
    root.setProperty('--modal-bg', 'rgba(255, 255, 255, 0.88)');
    root.setProperty('--input-bg', 'rgba(0, 0, 0, 0.06)');
    root.setProperty('--overlay-bg', 'rgba(0, 0, 0, 0.2)');
  } else {
    root.setProperty('--bg-deep', '#09090b');
    root.setProperty('--bg-sidebar', 'rgba(13, 13, 15, 0.92)');
    root.setProperty('--text-primary', '#ececf0');
    root.setProperty('--text-secondary', 'rgba(255, 255, 255, 0.5)');
    root.setProperty('--text-tertiary', 'rgba(255, 255, 255, 0.25)');
    root.setProperty('--border-subtle', 'rgba(255, 255, 255, 0.055)');
    root.setProperty('--modal-bg', 'rgba(20, 20, 22, 0.85)');
    root.setProperty('--input-bg', 'rgba(255, 255, 255, 0.06)');
    root.setProperty('--overlay-bg', 'rgba(0, 0, 0, 0.4)');
  }
}
applyTheme(currentTheme);

function openSettings() {
  $('settingsModal').style.display = 'flex';
}
function closeSettings() {
  $('settingsModal').style.display = 'none';
}

// Toast Notifications
function showToast(message) {
  const container = $('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Settings Tabs Logic
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    e.target.classList.add('active');
    $('tab-' + e.target.dataset.tab).classList.add('active');
  });
});

// Custom Cursor Preference
let useCustomCursor = localStorage.getItem('folio_custom_cursor') !== 'false';
let trafficLightHover = false;
let isFullscreen = false;
const customCursorCheck = $('customCursorCheck');
if (customCursorCheck) {
  customCursorCheck.checked = useCustomCursor;
  customCursorCheck.addEventListener('change', (e) => {
    useCustomCursor = e.target.checked;
    localStorage.setItem('folio_custom_cursor', useCustomCursor);
    updateCursorVisibility();
    showToast('Cursor preference saved');
  });
}

function updateCursorVisibility() {
  const shouldShowNative = !useCustomCursor || trafficLightHover;
  document.body.classList.toggle('force-native-cursor', shouldShowNative);
  getCurrentWindow().setCursorVisible(shouldShowNative).catch(() => {});
  if (shouldShowNative) {
    const customCursor = $('customCursor');
    if (customCursor) customCursor.style.opacity = 0;
  }
}

function setTrafficLightHover(active) {
  if (trafficLightHover === active) return;
  trafficLightHover = active;
  updateCursorVisibility();
}
updateCursorVisibility();

/* ── Sidebar Width & Collapse ── */
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 500;
let sidebarWidth = parseFloat(localStorage.getItem('folio_sidebar_w')) || 220;
let sidebarCollapsed = localStorage.getItem('folio_sidebar_collapsed') === 'true';

function clampSidebarWidth(value) {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value));
}

function setSidebarWidth(value, persist = true) {
  sidebarWidth = clampSidebarWidth(value);
  document.documentElement.style.setProperty('--sidebar-w', `${sidebarWidth}px`);
  if (persist) localStorage.setItem('folio_sidebar_w', sidebarWidth);
}

function applySidebarCollapsed() {
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed', sidebarCollapsed);
  if (sidebarToggle) {
    sidebarToggle.classList.toggle('collapsed', sidebarCollapsed);
    const label = sidebarCollapsed ? 'Show' : 'Hide';
    sidebarToggle.textContent = label;
    sidebarToggle.title = `${label} Sidebar`;
  }
  localStorage.setItem('folio_sidebar_collapsed', sidebarCollapsed);
}

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  applySidebarCollapsed();
}

setSidebarWidth(sidebarWidth);
applySidebarCollapsed();

if (sidebarToggle) {
  sidebarToggle.addEventListener('click', toggleSidebar);
}

async function syncFullscreenState() {
  try {
    isFullscreen = await getCurrentWindow().isFullscreen();
  } catch {
    isFullscreen = false;
  }
  if (isFullscreen && trafficLightHover) {
    trafficLightHover = false;
    updateCursorVisibility();
  }
  if (fullscreenBtn) {
    fullscreenBtn.classList.toggle('active', isFullscreen);
    fullscreenBtn.textContent = isFullscreen ? 'EXIT' : 'FULL';
    fullscreenBtn.title = isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen';
  }
}

async function toggleFullscreen() {
  try {
    await getCurrentWindow().setFullscreen(!isFullscreen);
    await syncFullscreenState();
  } catch (err) {
    console.error('[Folio] Fullscreen toggle failed:', err);
  }
}

if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', () => {
    toggleFullscreen();
  });
}
syncFullscreenState();

if (sidebarResizer) {
  let resizing = false;
  let startX = 0;
  let startWidth = 0;

  sidebarResizer.addEventListener('mousedown', (e) => {
    if (sidebarCollapsed) return;
    resizing = true;
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    sidebarResizer.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const dx = e.clientX - startX;
    setSidebarWidth(startWidth + dx);
  });

  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    sidebarResizer.classList.remove('dragging');
    document.body.style.cursor = '';
    updateThumbMaxSide();
  });
}

sortSelect.addEventListener('change', (e) => {
  currentSort = e.target.value;
  localStorage.setItem('folio_sort', currentSort);
  sortItems();
  showToast('Sort order changed');
});
zoomSensSlider.addEventListener('input', (e) => {
  zoomSens = parseFloat(e.target.value);
  localStorage.setItem('folio_zoom_sens', zoomSens);
});
themeSelect.addEventListener('change', (e) => {
  currentTheme = e.target.value;
  localStorage.setItem('folio_theme', currentTheme);
  applyTheme(currentTheme);
  showToast('Theme applied');
});

if (cinematicCheck) {
  cinematicCheck.addEventListener('change', (e) => {
    cinematicEnabled = e.target.checked;
    localStorage.setItem('folio_cinematic', cinematicEnabled);
    showToast('Cinematic transitions updated');
  });
}

function formatKey(key) {
  if (key === ' ') return 'Space';
  if (key === 'ArrowRight') return '→';
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key === 'Escape') return 'Esc';
  if (key === 'Shift') return '⇧';
  if (key === 'Control') return '⌃';
  if (key === 'Alt') return '⌥';
  if (key === 'Meta') return '⌘';
  return key.length === 1 ? key.toUpperCase() : key;
}

function updateKeybindsUI() {
  document.querySelectorAll('.keybind-btn').forEach(btn => {
    const action = btn.dataset.action;
    btn.textContent = formatKey(keybinds[action]);
  });
  
  const shortcuts = document.querySelector('.welcome-shortcuts');
  if (shortcuts) {
    shortcuts.innerHTML = `
      <span><kbd>${formatKey(keybinds.modifierZoom)}</kbd> + Scroll to Zoom</span>
      <span><kbd>${formatKey(keybinds.modifierPan)}</kbd> + Mid Click to Pan</span>
      <span>Drag to Move Window</span>
    `;
  }
}

updateKeybindsUI();

/* ── Welcome Parallax ── */
if (welcome && welcomeBg) {
  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;
  let parallaxRaf = 0;

  const tickParallax = () => {
    const dx = targetX - currentX;
    const dy = targetY - currentY;
    currentX += dx * 0.12;
    currentY += dy * 0.12;
    welcomeBg.style.setProperty('--parallax-x', `${currentX.toFixed(2)}px`);
    welcomeBg.style.setProperty('--parallax-y', `${currentY.toFixed(2)}px`);

    if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
      parallaxRaf = requestAnimationFrame(tickParallax);
    } else {
      parallaxRaf = 0;
    }
  };

  const scheduleParallax = () => {
    if (parallaxRaf) return;
    parallaxRaf = requestAnimationFrame(tickParallax);
  };

  welcome.addEventListener('mousemove', (e) => {
    if (welcome.classList.contains('hidden')) return;
    const rect = welcome.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    targetX = nx * 36;
    targetY = ny * 28;
    scheduleParallax();
  });

  welcome.addEventListener('mouseleave', () => {
    targetX = 0;
    targetY = 0;
    scheduleParallax();
  });
}

$('resetKeybindsBtn').addEventListener('click', () => {
  keybinds = { ...defaultKeybinds };
  localStorage.setItem('folio_keybinds', JSON.stringify(keybinds));
  updateKeybindsUI();
  showToast('Keybindings reset to defaults');
});

let listeningBtn = null;
document.querySelectorAll('.keybind-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    if (listeningBtn) {
      listeningBtn.textContent = formatKey(keybinds[listeningBtn.dataset.action]);
      listeningBtn.classList.remove('listening');
    }
    listeningBtn = btn;
    btn.textContent = 'Press key...';
    btn.classList.add('listening');
    e.stopPropagation();
  });
});


function sortItems() {
  if (!items.length) return;
  const currentPath = items[idx]?.path;

  items.sort((a, b) => {
    if (currentSort === 'name') {
      const nameA = a.path.split('/').pop().toLowerCase();
      const nameB = b.path.split('/').pop().toLowerCase();
      return nameA.localeCompare(nameB);
    } else if (currentSort === 'size') {
      return b.size - a.size;
    } else if (currentSort === 'date') {
      return b.modified - a.modified;
    }
    return 0;
  });

  if (currentPath) {
    const newIdx = items.findIndex(i => i.path === currentPath);
    if (newIdx !== -1) idx = newIdx;
  }

  if (filmstrip.children.length) {
    reorderFilmstripWithFlip();
  } else {
    buildFilmstrip();
  }
  highlightThumb();
}

/* ── Events ── */
$('openBtn').addEventListener('click', openFolder);
$('openBtn2').addEventListener('click', openFolder);
$('settingsClose').addEventListener('click', closeSettings);
$('settingsBg').addEventListener('click', closeSettings);
$('prev').addEventListener('click', () => nav(-1));
$('next').addEventListener('click', () => nav(1));
$('zoomReset').addEventListener('click', resetZoom);
zoomSlider.addEventListener('input', (e) => {
  setZoom(parseInt(e.target.value) / 100, 0, 0, { smooth: false });
});

/* ── Menu event listeners (Tauri IPC) ── */
listen('menu-open-folder', () => {
  openFolder();
}).catch(e => console.error('[Folio] Failed to listen for menu-open-folder:', e));

listen('menu-settings', () => {
  openSettings();
}).catch(e => console.error('[Folio] Failed to listen for menu-settings:', e));

/* ── Drag & Drop ── */
getCurrentWindow().onDragDropEvent(async (event) => {
  if (event.payload.type !== 'drop') return;
  const paths = event.payload.paths;
  if (!paths || paths.length === 0) return;
  
  try {
    const droppedPath = paths[0];
    const pathStr = await invoke('open_specific_folder', { path: droppedPath });
    
    const name = pathStr.split('/').pop() || pathStr;
    const list = await invoke('get_folder_items');
    if (!list.length) {
      showToast('No media found in dropped folder');
      return;
    }
    
    items = list;
    
    // Check if the dropped item was a file and jump to it
    let newIdx = items.findIndex(i => i.path === droppedPath);
    idx = newIdx !== -1 ? newIdx : 0;
    
    sortItems();
    welcome.classList.add('hidden');
    sidebar.style.display = 'flex';
    viewer.style.display = 'flex';
    applySidebarCollapsed();
    folderLabel.textContent = name;
    show(idx);
    showToast(`Loaded ${items.length} items`);
  } catch (err) {
    console.error('[Folio] File drop error:', err);
    showToast('Error opening dropped file/folder');
  }
}).catch(e => console.error('[Folio] Failed to listen for drag-drop:', e));

/* ── Keyboard shortcuts (reliable fallback) ── */
window.addEventListener('keydown', (e) => {
  if (listeningBtn) {
    e.preventDefault();
    if (e.key === 'Escape') {
      listeningBtn.textContent = formatKey(keybinds[listeningBtn.dataset.action]);
      listeningBtn.classList.remove('listening');
      listeningBtn = null;
      return;
    }
    const action = listeningBtn.dataset.action;
    let key = e.key;
    if (action.startsWith('modifier')) {
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(key)) {
        listeningBtn.textContent = 'Must be Shift/Ctrl/Alt/Cmd';
        const resetBtn = listeningBtn;
        setTimeout(() => {
          if (listeningBtn === resetBtn) {
            listeningBtn.textContent = formatKey(keybinds[action]);
            listeningBtn.classList.remove('listening');
            listeningBtn = null;
          }
        }, 1000);
        return;
      }
    }
    keybinds[action] = key;
    localStorage.setItem('folio_keybinds', JSON.stringify(keybinds));
    updateKeybindsUI();
    listeningBtn.classList.remove('listening');
    listeningBtn = null;
    return;
  }

  // Cmd+O to open folder
  if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
    e.preventDefault();
    openFolder();
    return;
  }
  // Cmd+, to open settings
  if ((e.metaKey || e.ctrlKey) && e.key === ',') {
    e.preventDefault();
    openSettings();
    return;
  }
  // Cmd+B to toggle sidebar
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    toggleSidebar();
    return;
  }
  // Escape to close settings
  if (e.key === 'Escape') {
    closeSettings();
    return;
  }

  const tagName = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  const isTypingField = ['input', 'textarea', 'select'].includes(tagName);
  if (!isTypingField && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    toggleFullscreen();
    return;
  }

  if (!items.length) return;
  const k = e.key.toLowerCase();
  
  if (k === keybinds.nextImage.toLowerCase() || e.key === 'ArrowDown') { e.preventDefault(); nav(1); }
  else if (k === keybinds.prevImage.toLowerCase() || e.key === 'ArrowUp') { e.preventDefault(); nav(-1); }
  else if (e.key === 'Home') { e.preventDefault(); show(0); }
  else if (e.key === 'End') { e.preventDefault(); show(items.length - 1); }
  else if (k === keybinds.playVideo.toLowerCase()) {
    e.preventDefault();
    const v = media.querySelector('.media-layer.media-active video');
    if (v) v.paused ? v.play() : v.pause();
  }
  else if (k === keybinds.resetZoom.toLowerCase()) { resetZoom(); }
  else if (k === keybinds.toggleMetadata.toLowerCase()) { toggleEditorialOverlay(); }
});

/* ── Zoom/Pan State ── */
let panX = 0, panY = 0;
let isDragging = false, startX, startY;
let pendingRafUpdate = false;
let targetZoom = 1;
let zoomRaf = 0;
let zoomAnchorX = 0;
let zoomAnchorY = 0;

function getActiveImage() {
  return media.querySelector('.media-layer.media-active img.media-content');
}

function scheduleUpdate() {
  if (pendingRafUpdate) return;
  pendingRafUpdate = true;
  requestAnimationFrame(() => {
    pendingRafUpdate = false;
    const img = getActiveImage();
    if (img) img.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
  });
}

/* ── Shift+Scroll Zoom ── */
media.addEventListener('wheel', (e) => {
  const modProp = keybinds.modifierZoom.toLowerCase() + 'Key';
  if (!e[modProp]) return;
  e.preventDefault();

  const img = getActiveImage();
  if (!img) return;

  const delta = e.deltaY || e.deltaX;
  const sensMultiplier = 0.001 * (zoomSens / 5);
  const scale = Math.exp(-delta * sensMultiplier);
  const baseZoom = targetZoom || zoom;
  let newZoom = baseZoom * scale;
  newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));

  if (Math.abs(newZoom - targetZoom) > 0.0005) {
    const rect = media.getBoundingClientRect();
    const cx = e.clientX - rect.left - (rect.width / 2);
    const cy = e.clientY - rect.top - (rect.height / 2);
    setZoom(newZoom, cx, cy, { smooth: true });
  }
}, { passive: false });

function applyZoom(level, cx, cy, allowSnap = true) {
  const img = getActiveImage();
  if (!img) return;

  const oldZoom = zoom;
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, level));
  zoom = clamped;

  if (allowSnap && zoom <= 1.01) {
    zoom = 1;
    panX = 0;
    panY = 0;
    img.classList.remove('zoomed');
    img.style.transform = '';
    media.classList.remove('panning');
  } else {
    img.classList.add('zoomed');
    media.classList.add('panning');

    if (cx !== undefined && cy !== undefined) {
      const dx = cx - panX;
      const dy = cy - panY;
      const ratio = zoom / oldZoom;
      panX = cx - dx * ratio;
      panY = cy - dy * ratio;
    }

    scheduleUpdate();
  }

  zoomSlider.value = Math.round(zoom * 100);
  zoomLabel.textContent = Math.round(zoom * 100) + '%';
}

function setZoom(level, cx, cy, options = {}) {
  const { smooth = false } = options;
  targetZoom = level;
  if (cx !== undefined && cy !== undefined) {
    zoomAnchorX = cx;
    zoomAnchorY = cy;
  }

  if (!smooth) {
    if (zoomRaf) cancelAnimationFrame(zoomRaf);
    zoomRaf = 0;
    applyZoom(level, cx, cy, true);
    return;
  }

  if (zoomRaf) return;
  const step = () => {
    const diff = targetZoom - zoom;
    if (Math.abs(diff) < 0.001) {
      zoomRaf = 0;
      applyZoom(targetZoom, zoomAnchorX, zoomAnchorY, true);
      return;
    }
    const nextZoom = zoom + diff * 0.2;
    applyZoom(nextZoom, zoomAnchorX, zoomAnchorY, targetZoom <= 1.01);
    zoomRaf = requestAnimationFrame(step);
  };
  zoomRaf = requestAnimationFrame(step);
}

/* ── Drag Panning & Window Dragging ── */
media.addEventListener('mousedown', async (e) => {
  if (e.detail > 1) e.preventDefault(); // Prevent text selection on double-click

  // If not zoomed in and left-clicking, drag the entire window
  if (zoom <= 1 && e.button === 0) {
    e.preventDefault();
    getCurrentWindow().startDragging();
    return;
  }

  // Panning is allowed if zoomed in, AND either:
  // - Left click (e.button === 0)
  // - Modifier + Middle click (e.button === 1 && e[modProp])
  const modProp = keybinds.modifierPan.toLowerCase() + 'Key';
  const isPanClick = (e.button === 0) || (e.button === 1 && e[modProp]);
  
  if (zoom <= 1 || !isPanClick) return;
  
  // Prevent default to stop weird scrolling/selection behavior
  if (e.button === 1) e.preventDefault();

  isDragging = true;
  startX = e.clientX - panX;
  startY = e.clientY - panY;
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  panX = e.clientX - startX;
  panY = e.clientY - startY;
  scheduleUpdate();
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

function resetZoom() {
  setZoom(1, 0, 0, { smooth: false });
}

/* ── Core ── */
async function openFolder() {
  try {
    const path = await invoke('open_folder_picker');
    if (!path) return;
    const name = path.split('/').pop() || path;
    const list = await invoke('get_folder_items');
    if (!list.length) return;
    items = list;
    idx = 0;
    sortItems();
    welcome.classList.add('hidden');
    sidebar.style.display = 'flex';
    viewer.style.display = 'flex';
    applySidebarCollapsed();
    folderLabel.textContent = name;
    show(idx);
  } catch (err) { console.error('[Folio] openFolder error:', err); }
}

function nav(dir) {
  if (!items.length) return;
  show((idx + dir + items.length) % items.length, dir);
}

function clearMediaContent(keepNode = null) {
  Array.from(media.children).forEach((child) => {
    if (mediaLoader && child === mediaLoader) return;
    if (keepNode && child === keepNode) return;
    child.remove();
  });
}

function applyCinematicExit(node, direction) {
  node.classList.remove('media-active');
  node.classList.add('exiting');
  node.style.setProperty('--cinematic-x', `${direction * -24}px`);
  const cleanup = () => node.remove();
  node.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, 520);
}

function show(i, dir = null) {
  const prevIdx = idx;
  const direction = dir !== null ? dir : (i > prevIdx ? 1 : i < prevIdx ? -1 : 0);
  idx = i;
  zoom = 1; panX = 0; panY = 0;
  targetZoom = 1;
  if (zoomRaf) {
    cancelAnimationFrame(zoomRaf);
    zoomRaf = 0;
  }
  zoomSlider.value = 100;
  zoomLabel.textContent = '100%';
  media.classList.remove('panning');

  const item = items[i];
  const src = `folio://localhost/${encodeURIComponent(item.path)}`;
  const shouldCinematic = cinematicEnabled && direction !== 0;
  const outgoing = shouldCinematic ? media.querySelector('.media-layer.media-active') : null;

  if (outgoing) applyCinematicExit(outgoing, direction);
  clearMediaContent(outgoing);

  const layer = document.createElement('div');
  layer.className = 'media-layer media-item media-active';

  if (shouldCinematic) {
    layer.classList.add('entering');
    layer.style.setProperty('--cinematic-x', `${direction * 24}px`);
  }

  if (item.is_video) {
    media.classList.remove('loading');
    const v = document.createElement('video');
    v.className = 'media-content';
    v.controls = true; v.autoplay = true; v.loop = true;
    v.playsInline = true; v.src = src;
    v.onloadeddata = () => v.classList.add('loaded');
    layer.appendChild(v);
    media.appendChild(layer);
    if (shouldCinematic) requestAnimationFrame(() => layer.classList.remove('entering'));
  } else {
    media.classList.add('loading');
    const thumbSrc = preloadedThumbs.get(item.path);
    if (thumbSrc) {
      const placeholder = document.createElement('img');
      placeholder.alt = '';
      placeholder.src = thumbSrc;
      placeholder.className = 'placeholder-thumb loaded';
      layer.appendChild(placeholder);
    }

    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.className = 'media-content';

    const cached = preloadCache.get(item.path);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      img.src = cached.src;
      img.classList.add('loaded');
      media.classList.remove('loading');
      const ph = layer.querySelector('.placeholder-thumb');
      if (ph) ph.remove();
    } else {
      img.src = src;
      img.onload = () => {
        img.classList.add('loaded');
        media.classList.remove('loading');
        const ph = layer.querySelector('.placeholder-thumb');
        if (ph) ph.remove();
      };
    }

    layer.appendChild(img);
    media.appendChild(layer);
    if (shouldCinematic) requestAnimationFrame(() => layer.classList.remove('entering'));
  }

  const base = item.path.split('/').pop() || '';
  const ext = base.split('.').pop().toLowerCase();
  counter.textContent = `${i + 1} of ${items.length}`;
  fname.textContent = base;
  dims.textContent = `${item.width} × ${item.height}`;
  badge.style.display = 'inline-block';
  badge.textContent = ext.toUpperCase();
  badge.className = `format-badge fmt-${ext}`;

  // Populate Editorial Metadata
  if (item.exif) {
    edCamera.textContent = item.exif.camera || 'Unknown Camera';
    edAperture.textContent = item.exif.aperture || '—';
    edShutter.textContent = item.exif.shutter_speed || '—';
    edIso.textContent = item.exif.iso || '—';
    edFocal.textContent = item.exif.focal_length || '—';
  } else {
    edCamera.textContent = 'No Metadata';
    edAperture.textContent = '—';
    edShutter.textContent = '—';
    edIso.textContent = '—';
    edFocal.textContent = '—';
  }

  // Extract color for background tint
  if (!item.is_video && currentTheme === 'dark') {
    const thumbSrc = preloadedThumbs.get(item.path);
    if (thumbSrc) {
      const tempImg = new Image();
      tempImg.src = thumbSrc;
      tempImg.onload = () => {
        bgTint.style.background = extractDominantColor(tempImg);
        bgTint.style.opacity = 1;
      };
    } else {
      bgTint.style.opacity = 0;
    }
  } else {
    bgTint.style.opacity = 0;
  }

  highlightThumb();

  // Preload neighbors
  for (let offset = 1; offset <= 3; offset++) preloadImage(i + offset);
  for (let offset = 1; offset <= 2; offset++) preloadImage(i - offset);
}

/* ── Preload cache ── */
const preloadCache = new Map();
const preloadedThumbs = new Map();

function preloadImage(targetIdx) {
  if (targetIdx < 0 || targetIdx >= items.length) return;
  const item = items[targetIdx];
  if (item.is_video) return;
  if (preloadCache.has(item.path)) return; // already preloading/preloaded
  const img = new Image();
  img.src = `folio://localhost/${encodeURIComponent(item.path)}`;
  preloadCache.set(item.path, img);
}

function cacheThumbUrl(path, url) {
  preloadedThumbs.set(path, url);
}

/* ── Filmstrip with concurrency-limited thumbnail loading ── */
const THUMB_CONCURRENCY = 8;
let thumbQueue = [];
let thumbActive = 0;
const THUMB_MIN = 160;
const THUMB_MAX = 480;
let thumbMaxSide = computeThumbMaxSide();
updateThumbMaxSide({ force: true });

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeThumbMaxSide() {
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const baseWidth = sidebarCollapsed ? sidebarWidth : (sidebar?.getBoundingClientRect().width || sidebarWidth);
  return Math.round(clamp(baseWidth * scale, THUMB_MIN, THUMB_MAX));
}

function refreshLoadedThumbs() {
  const thumbs = filmstrip.querySelectorAll('.thumb');
  thumbs.forEach((el) => {
    if (el.dataset.vid === '1') return;
    if (el.dataset.loaded !== '1') return;
    enqueueThumb(el, el.dataset.path, true);
  });
}

function updateThumbMaxSide({ force = false } = {}) {
  const next = computeThumbMaxSide();
  if (!force && next <= thumbMaxSide + 8) return;
  thumbMaxSide = next;
  refreshLoadedThumbs();
}

function enqueueThumb(el, path, force = false) {
  thumbQueue.push({ el, path, retries: 0, force });
  processThumbQueue();
}

async function processThumbQueue() {
  while (thumbActive < THUMB_CONCURRENCY && thumbQueue.length > 0) {
    const job = thumbQueue.shift();
    thumbActive++;
    loadThumb(job).finally(() => {
      thumbActive--;
      processThumbQueue();
    });
  }
}

async function loadThumb({ el, path, retries, force }) {
  try {
    if (!force) {
      const currentSize = parseInt(el.dataset.thumbSize || '0', 10);
      if (currentSize >= thumbMaxSide) return;
    }
    const tp = await invoke('get_thumbnail', { path, maxSide: thumbMaxSide });
    const thumbUrl = `folio://localhost/${encodeURIComponent(tp)}`;
    const img = el.querySelector('img');
    if (img) {
      img.src = thumbUrl;
      img.onload = () => img.classList.add('loaded');
    }
    el.dataset.thumbSize = String(thumbMaxSide);
    cacheThumbUrl(path, thumbUrl);
  } catch (err) {
    if (retries < 2) {
      await new Promise(r => setTimeout(r, 500));
      thumbQueue.push({ el, path, retries: retries + 1 });
    } else {
      const img = el.querySelector('img');
      if (img) {
        img.src = `folio://localhost/${encodeURIComponent(path)}`;
        img.onload = () => img.classList.add('loaded');
      }
    }
  }
}

const obs = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const el = en.target;
    if (el.dataset.loaded) continue;
    el.dataset.loaded = '1';

    const path = el.dataset.path;
    const isVid = el.dataset.vid === '1';

    if (isVid) {
      const v = el.querySelector('video');
      if (v) {
        v.src = `folio://localhost/${encodeURIComponent(path)}`;
        v.addEventListener('loadeddata', () => {
          v.currentTime = Math.min(1, v.duration || 0);
          v.classList.add('loaded');
        }, { once: true });
      }
    } else {
      enqueueThumb(el, path);
    }
    obs.unobserve(el);
  }
}, { root: filmstrip, rootMargin: '400px 0px' });

function buildFilmstrip() {
  obs.disconnect();
  thumbQueue = [];
  thumbActive = 0;
  filmstrip.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const d = document.createElement('div');
    d.className = i === idx ? 'thumb active' : 'thumb';
    d.dataset.index = i;
    d.dataset.path = item.path;
    d.dataset.vid = item.is_video ? '1' : '0';

    if (item.is_video) {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      d.appendChild(v);

      const play = document.createElement('div');
      play.className = 'play-icon';
      play.textContent = '▶';
      d.appendChild(play);

      const b = document.createElement('span');
      b.className = 'vid-badge';
      b.textContent = item.path.split('.').pop().toUpperCase();
      d.appendChild(b);
    } else {
      const img = document.createElement('img');
      img.alt = '';
      d.appendChild(img);
    }

    d.addEventListener('click', () => {
      const targetIdx = parseInt(d.dataset.index, 10);
      const dir = targetIdx === idx ? 0 : (targetIdx > idx ? 1 : -1);
      show(targetIdx, dir);
    });
    frag.appendChild(d);
    obs.observe(d);
  }
  filmstrip.appendChild(frag);
}

function reorderFilmstripWithFlip() {
  const thumbs = Array.from(filmstrip.children).filter(el => el.classList.contains('thumb'));
  if (!thumbs.length) {
    buildFilmstrip();
    return;
  }

  const firstRects = new Map();
  thumbs.forEach(t => firstRects.set(t.dataset.path, t.getBoundingClientRect()));

  const nodeByPath = new Map(thumbs.map(t => [t.dataset.path, t]));
  const frag = document.createDocumentFragment();
  let missingNode = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const node = nodeByPath.get(item.path);
    if (!node) {
      missingNode = true;
      break;
    }
    node.dataset.index = i;
    frag.appendChild(node);
  }

  if (missingNode) {
    buildFilmstrip();
    return;
  }

  filmstrip.innerHTML = '';
  filmstrip.appendChild(frag);

  const lastRects = new Map();
  for (const item of items) {
    const node = nodeByPath.get(item.path);
    if (node) lastRects.set(item.path, node.getBoundingClientRect());
  }

  for (const item of items) {
    const node = nodeByPath.get(item.path);
    const first = firstRects.get(item.path);
    const last = lastRects.get(item.path);
    if (!node || !first || !last) continue;
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (dx || dy) {
      node.style.setProperty('--flip-x', `${dx}px`);
      node.style.setProperty('--flip-y', `${dy}px`);
      node.style.transition = 'none';
      requestAnimationFrame(() => {
        node.style.transition = '';
        node.style.setProperty('--flip-x', '0px');
        node.style.setProperty('--flip-y', '0px');
      });
    }
  }
}

function highlightThumb() {
  const thumbs = filmstrip.querySelectorAll('.thumb');
  thumbs.forEach((t, i) => {
    if (i === idx) {
      t.classList.add('active');
      t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      t.classList.remove('active');
    }
  });
}

/* ── Auto-Update ── */
let pendingUpdate = null;
const autoUpdateCheckbox = $('autoUpdateCheck');
const autoCheckEnabled = localStorage.getItem('folio_auto_update') !== 'false';
autoUpdateCheckbox.checked = autoCheckEnabled;

autoUpdateCheckbox.addEventListener('change', (e) => {
  localStorage.setItem('folio_auto_update', e.target.checked);
});

$('checkUpdateBtn').addEventListener('click', () => {
  checkForUpdates(true);
});

$('updateAction').addEventListener('click', async () => {
  if (!pendingUpdate) return;
  $('updateText').textContent = 'Downloading update...';
  $('updateAction').disabled = true;
  try {
    await pendingUpdate.downloadAndInstall((progress) => {
      if (progress.event === 'Progress') {
        const pct = Math.round((progress.data.chunkLength / progress.data.contentLength) * 100);
        $('updateText').textContent = `Downloading... ${pct}%`;
      }
    });
    $('updateText').textContent = 'Update installed! Restarting...';
    // The app will restart automatically after install
  } catch (err) {
    console.error('[Folio] Update install failed:', err);
    $('updateText').textContent = 'Update failed. Try again later.';
    $('updateAction').disabled = false;
  }
});

$('updateDismiss').addEventListener('click', () => {
  $('updateBar').style.display = 'none';
  pendingUpdate = null;
});

async function checkForUpdates(manual = false) {
  try {
    const update = await check();
    if (update) {
      pendingUpdate = update;
      $('updateText').textContent = `Update available: v${update.version}`;
      $('updateBar').style.display = 'flex';
    } else if (manual) {
      $('updateText').textContent = 'You\'re on the latest version!';
      $('updateBar').style.display = 'flex';
      $('updateAction').style.display = 'none';
      setTimeout(() => {
        $('updateBar').style.display = 'none';
        $('updateAction').style.display = '';
      }, 3000);
    }
  } catch (err) {
    console.log('[Folio] Update check skipped:', err.message || err);
    if (manual) {
      $('updateText').textContent = 'Could not check for updates.';
      $('updateBar').style.display = 'flex';
      $('updateAction').style.display = 'none';
      setTimeout(() => {
        $('updateBar').style.display = 'none';
        $('updateAction').style.display = '';
      }, 3000);
    }
  }
}

// Auto-check on startup (with short delay so UI loads first)
if (autoCheckEnabled) {
  setTimeout(() => checkForUpdates(false), 2000);
}

/* ═══ LUXURY UI FEATURES ═══ */

// 1. Custom Magnetic Cursor
const customCursor = $('customCursor');
let cursorVisible = false;

window.addEventListener('mousemove', (e) => {
  const inTrafficLights = !isFullscreen && e.clientX <= 80 && e.clientY <= 40;
  if (useCustomCursor) {
    setTrafficLightHover(inTrafficLights);
  } else if (trafficLightHover) {
    setTrafficLightHover(false);
  }

  if (!useCustomCursor || trafficLightHover) {
    if (customCursor) customCursor.style.opacity = 0;
    cursorVisible = false;
    return;
  }

  if (!cursorVisible) {
    customCursor.style.opacity = 1;
    cursorVisible = true;
  }
  customCursor.style.left = e.clientX + 'px';
  customCursor.style.top = e.clientY + 'px';
  
  // Magnetic effect on interactive elements
  const target = e.target;
  if (target.closest('button, .thumb, input, select, .welcome-btn, .sidebar-dragbar, .sidebar-toggle')) {
    customCursor.classList.add('hovering');
  } else {
    customCursor.classList.remove('hovering');
  }
});
window.addEventListener('mouseout', () => {
  customCursor.style.opacity = 0;
  cursorVisible = false;
});

// 2. Editorial Metadata Overlay
let overlayVisible = false;
const edOverlay = $('editorialOverlay');
const edCamera = $('edCamera');
const edAperture = $('edAperture');
const edShutter = $('edShutter');
const edIso = $('edIso');
const edFocal = $('edFocal');

function toggleEditorialOverlay() {
  if (!items.length || viewer.style.display === 'none') return;
  overlayVisible = !overlayVisible;
  if (overlayVisible) {
    edOverlay.classList.add('visible');
  } else {
    edOverlay.classList.remove('visible');
  }
}

// 3. Double-Click Smart Zoom
media.addEventListener('dblclick', (e) => {
  if (zoom > 1) {
    resetZoom();
  } else {
    const rect = media.getBoundingClientRect();
    const cx = e.clientX - rect.left - (rect.width / 2);
    const cy = e.clientY - rect.top - (rect.height / 2);
    setZoom(2.0, cx, cy, { smooth: false });
  }
});

// 4. Fast Canvas-based Color Extraction for Dynamic Tint
const bgTint = $('bgTint');
const colorCanvas = document.createElement('canvas');
const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });
colorCanvas.width = 64;
colorCanvas.height = 64;

function extractDominantColor(imgEl) {
  try {
    colorCtx.drawImage(imgEl, 0, 0, 64, 64);
    const data = colorCtx.getImageData(0, 0, 64, 64).data;
    let r = 0, g = 0, b = 0;
    const pixelCount = 64 * 64;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i+1];
      b += data[i+2];
    }
    r = Math.floor(r / pixelCount);
    g = Math.floor(g / pixelCount);
    b = Math.floor(b / pixelCount);
    // Darken slightly for subtlety
    return `rgba(${r}, ${g}, ${b}, 0.25)`;
  } catch (e) {
    return 'transparent';
  }
}
