import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { save, open } from '@tauri-apps/plugin-dialog';

/* ── State ── */
let items = [];
let idx = 0;
let zoom = 1;
let panX = 0, panY = 0;
let isDragging = false, startX, startY;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
let overlayVisible = false;
let isFullscreen = false;

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
      <div class="welcome-dropzone" id="welcomeDropzone">
        <span class="drop-icon">📥</span>
        <span class="drop-text">Drop Folder Here</span>
      </div>
      <button class="welcome-btn" id="openBtn"><span>Open Folder</span></button>
      <div class="recent-folders" id="recentFolders"></div>
      <div class="welcome-shortcuts">
        <span><kbd>⇧</kbd> + Scroll to Zoom</span>
        <span><kbd>⇧</kbd> + Mid Click to Pan</span>
        <span>Drag to Move Window</span>
      </div>
    </div>
  </div>

  <div class="sidebar" id="sidebar" style="display:none">
    <div class="sidebar-dragbar" id="sDrag" data-tauri-drag-region>
        <div class="breadcrumbs" id="breadcrumbs"></div>
        <button class="grid-toggle-btn" id="gridToggleBtn" data-tooltip="Toggle Grid View">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
        </button>
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
    <div class="backdrop-glow" id="backdropGlow"></div>
    <div class="viewer-dragbar" id="vDrag" data-tauri-drag-region></div>
    <button class="sidebar-toggle" id="sidebarToggle" data-tooltip="Toggle Sidebar (B)">Sidebar</button>
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
      <div class="editorial-tech-data" id="edTechData"></div>
      <canvas class="editorial-histogram" id="histogramCanvas" width="220" height="56" aria-hidden="true"></canvas>
      <div class="editorial-palette" id="editorialPalette" style="margin-top: 16px; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px;">
        <span class="editorial-stat-label">Dominant Palette</span>
        <div id="paletteChips" style="display: flex; gap: 8px; margin-top: 4px;"></div>
      </div>
    </div>
    <button class="nav-arrow prev" id="prev">‹</button>
    <button class="nav-arrow next" id="next">›</button>
    <div class="zoom-hud" id="zoomHud">
      <input type="range" id="zoomSlider" min="100" max="800" value="100" step="10" />
      <span class="zoom-label" id="zoomLabel">100%</span>
      <button class="zoom-reset" id="zoomReset" data-tooltip="Fit to Screen (0)">FIT</button>
      <button class="zoom-action fullscreen-toggle" id="fullscreenBtn" data-tooltip="Enter Fullscreen (F)">FULL</button>
    </div>

    <div class="edit-panel" id="editPanel" aria-hidden="true">
      <div class="edit-panel-header">
        <span class="edit-panel-title">Edit Photo</span>
        <div class="edit-panel-actions">
          <button class="edit-action-btn" id="editResetBtn">Reset</button>
          <button class="edit-action-btn edit-export-btn" id="editExportBtn">Export</button>
          <button class="edit-close-btn" id="editCloseBtn">×</button>
        </div>
      </div>
      <div class="edit-sliders">
        <div class="edit-row"><label>Brightness</label><input type="range" class="edit-slider" data-param="brightness" min="-100" max="100" step="1" value="0"><span class="edit-val">0</span></div>
        <div class="edit-row"><label>Vibrance</label><input type="range" class="edit-slider" data-param="vibrance" min="-100" max="100" step="1" value="0"><span class="edit-val">0</span></div>
      </div>
      <div class="edit-footer" style="flex-direction: column; gap: 8px;">
        <div style="display: flex; gap: 8px; width: 100%;">
          <button class="edit-flip-btn" id="rotateBtn" style="flex: 1;">Rotate 90°</button>
          <button class="edit-flip-btn" id="flipHBtn" style="flex: 1;">Flip H</button>
          <button class="edit-flip-btn" id="flipVBtn" style="flex: 1;">Flip V</button>
        </div>
        <button class="edit-flip-btn" id="cropBtn" style="width: 100%; border-color: rgba(212,167,44,0.35); color: var(--accent-gold);">Crop Photo</button>
      </div>
    </div>
    <button class="edit-toggle-btn" id="editToggleBtn" data-tooltip="Edit Photo (E)">Edit</button>
  </div>

  <div class="image-fullscreen" id="imageFullscreen" aria-hidden="true" style="display:none">
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
          <div class="setting-row">
            <label for="recentFoldersCheck">Show Recent Folders</label>
            <input type="checkbox" id="recentFoldersCheck" checked />
          </div>
          <div class="setting-row">
            <label for="stripMetadataCheck">Scrub EXIF Metadata on Export</label>
            <input type="checkbox" id="stripMetadataCheck" checked />
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
            <label for="vibrancyCheck">Enable Window Vibrancy</label>
            <input type="checkbox" id="vibrancyCheck" />
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
  <div class="dropzone-glow" id="dropzoneGlow"></div>
  <div id="toastContainer" class="toast-container"></div>
`;

/* ── DOM REFS ── */
const $ = id => document.getElementById(id);
const welcome = $('welcome'), welcomeBg = $('welcomeBg'), sidebar = $('sidebar'), sidebarResizer = $('sidebarResizer'), sidebarToggle = $('sidebarToggle'), viewer = $('viewer'), media = $('media'), mediaLoader = $('mediaLoader'), filmstrip = $('filmstrip'), breadcrumbs = $('breadcrumbs'), gridToggleBtn = $('gridToggleBtn'), counter = $('counter'), fname = $('fname'), dims = $('dims'), badge = $('badge'), edOverlay = $('editorialOverlay'), edCamera = $('edCamera'), edAperture = $('edAperture'), edShutter = $('edShutter'), edIso = $('edIso'), edFocal = $('edFocal'), edTechData = $('edTechData'), backdropGlow = $('backdropGlow'), editPanel = $('editPanel'), editToggleBtn = $('editToggleBtn'), editCloseBtn = $('editCloseBtn'), editResetBtn = $('editResetBtn'), editExportBtn = $('editExportBtn'), rotateBtn = $('rotateBtn'), flipHBtn = $('flipHBtn'), flipVBtn = $('flipVBtn'), cropBtn = $('cropBtn'), customCursor = $('customCursor'), customCursorCheck = $('customCursorCheck'), dropzoneGlow = $('dropzoneGlow'), zoomSlider = $('zoomSlider'), zoomLabel = $('zoomLabel'), zoomReset = $('zoomReset'), fullscreenBtn = $('fullscreenBtn'), imageFsExit = $('imageFsExit'), sortSelect = $('sortSelect'), zoomSensSlider = $('zoomSensSlider'), themeSelect = $('themeSelect'), cinematicCheck = $('cinematicCheck'), recentFoldersCheck = $('recentFoldersCheck'), stripMetadataCheck = $('stripMetadataCheck'), vibrancyCheck = $('vibrancyCheck');

/* ── Settings & State ── */
let currentSort = localStorage.getItem('folio_sort') || 'name';
let zoomSens = parseFloat(localStorage.getItem('folio_zoom_sens')) || 5;
let currentTheme = localStorage.getItem('folio_theme') || 'dark';
let cinematicEnabled = localStorage.getItem('folio_cinematic') !== 'false';
let useCustomCursor = localStorage.getItem('folio_custom_cursor') !== 'false';
let showRecentFolders = localStorage.getItem('folio_show_recents') !== 'false';
let stripMetadataEnabled = localStorage.getItem('folio_strip_metadata') !== 'false';
let vibrancyEnabled = localStorage.getItem('folio_vibrancy') === 'true';
let gridView = localStorage.getItem('folio_grid_view') === 'true';

let trafficLightHover = false;
let pendingRafUpdate = false;
let editPanelOpen = false;
let editDebounceTimer = null;
let editPreviewImg = null;
const editMap = new Map();
const preloadedThumbs = new Map();
const preloadCache = new Map();

const defaultKeybinds = { nextImage: 'ArrowRight', prevImage: 'ArrowLeft', resetZoom: '0', toggleMetadata: 'i', playVideo: ' ', modifierZoom: 'Shift', modifierPan: 'Shift' };
let keybinds = { ...defaultKeybinds, ...JSON.parse(localStorage.getItem('folio_keybinds') || '{}') };

/* ── Init ── */
applyTheme(currentTheme);
if (recentFoldersCheck) {
  recentFoldersCheck.checked = showRecentFolders;
  recentFoldersCheck.addEventListener('change', (e) => {
    showRecentFolders = e.target.checked;
    localStorage.setItem('folio_show_recents', showRecentFolders);
    renderRecentFolders();
  });
}
if (stripMetadataCheck) {
  stripMetadataCheck.checked = stripMetadataEnabled;
  stripMetadataCheck.addEventListener('change', (e) => {
    stripMetadataEnabled = e.target.checked;
    localStorage.setItem('folio_strip_metadata', stripMetadataEnabled);
  });
}
if (vibrancyCheck) {
  vibrancyCheck.checked = vibrancyEnabled;
  vibrancyCheck.addEventListener('change', (e) => {
    vibrancyEnabled = e.target.checked;
    localStorage.setItem('folio_vibrancy', vibrancyEnabled);
    invoke('set_window_vibrancy', { enabled: vibrancyEnabled });
  });
}
// Apply initial vibrancy if enabled
if (vibrancyEnabled) invoke('set_window_vibrancy', { enabled: true });

/* ── Core UI Methods ── */
function applyTheme(theme) {
  const root = document.documentElement.style;
  if (theme === 'light') {
    root.setProperty('--bg-deep', '#f5f5f6');
    root.setProperty('--bg-sidebar', 'rgba(250, 250, 250, 0.94)');
    root.setProperty('--text-primary', '#1a1a1e');
    root.setProperty('--text-secondary', 'rgba(0, 0, 0, 0.55)');
    root.setProperty('--text-tertiary', 'rgba(0, 0, 0, 0.35)');
    root.setProperty('--border-subtle', 'rgba(0, 0, 0, 0.07)');
    root.setProperty('--modal-bg', 'rgba(255, 255, 255, 0.9)');
    root.setProperty('--input-bg', 'rgba(0, 0, 0, 0.05)');
    root.setProperty('--overlay-bg', 'rgba(0, 0, 0, 0.2)');
  } else {
    root.setProperty('--bg-deep', '#08080a');
    root.setProperty('--bg-sidebar', 'rgba(12, 12, 14, 0.94)');
    root.setProperty('--text-primary', '#f0f0f4');
    root.setProperty('--text-secondary', 'rgba(255, 255, 255, 0.48)');
    root.setProperty('--text-tertiary', 'rgba(255, 255, 255, 0.22)');
    root.setProperty('--border-subtle', 'rgba(255, 255, 255, 0.06)');
    root.setProperty('--modal-bg', 'rgba(18, 18, 20, 0.88)');
    root.setProperty('--input-bg', 'rgba(255, 255, 255, 0.06)');
    root.setProperty('--overlay-bg', 'rgba(0, 0, 0, 0.45)');
  }
}

/* ── Tooltips ── */
let tooltipEl = null;
function initTooltips() {
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'folio-tooltip';
  document.body.appendChild(tooltipEl);

  window.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (!target) {
      tooltipEl.classList.remove('visible', 'placement-top', 'placement-bottom');
      return;
    }
    tooltipEl.textContent = target.dataset.tooltip;
    
    const r = target.getBoundingClientRect();
    tooltipEl.style.left = `${r.left + r.width/2}px`;
    
    if (r.top < 45) {
      tooltipEl.className = 'folio-tooltip placement-bottom';
      tooltipEl.style.top = `${r.bottom}px`;
    } else {
      tooltipEl.className = 'folio-tooltip placement-top';
      tooltipEl.style.top = `${r.top}px`;
    }
    
    tooltipEl.classList.add('visible');
  });
}
initTooltips();

function makeEditable(element, fieldKey) {
  if (!element) return;
  element.style.cursor = 'pointer';
  element.title = 'Double-click to edit';
  
  element.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const originalText = element.textContent;
    if (element.querySelector('input')) return;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalText === '—' || originalText === 'Unknown Camera' || originalText === 'No Metadata' ? '' : originalText;
    input.className = 'ed-inline-input';
    
    element.textContent = '';
    element.appendChild(input);
    input.focus();
    
    let saved = false;
    const saveEdit = async () => {
      if (saved) return;
      saved = true;
      const newVal = input.value.trim() || '—';
      element.textContent = newVal;
      
      const item = items[idx];
      if (!item) return;
      if (!item.exif) item.exif = {};
      
      if (fieldKey === 'camera') item.exif.camera = newVal;
      else if (fieldKey === 'aperture') item.exif.aperture = newVal;
      else if (fieldKey === 'shutter') item.exif.shutter_speed = newVal;
      else if (fieldKey === 'iso') item.exif.iso = newVal;
      else if (fieldKey === 'focal') item.exif.focal_length = newVal;
      
      try {
        await invoke('update_exif_metadata', {
          path: item.path,
          camera: item.exif.camera || null,
          aperture: item.exif.aperture || null,
          shutterSpeed: item.exif.shutter_speed || null,
          iso: item.exif.iso || null,
          focalLength: item.exif.focal_length || null
        });
        showToast('Metadata updated');
      } catch (err) {
        showToast('Failed to save metadata');
        element.textContent = originalText;
      }
    };
    
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') saveEdit();
      if (evt.key === 'Escape') {
        saved = true;
        element.textContent = originalText;
      }
    });
    
    input.addEventListener('blur', saveEdit);
  });
}
makeEditable(edCamera, 'camera');
makeEditable(edAperture, 'aperture');
makeEditable(edShutter, 'shutter');
makeEditable(edIso, 'iso');
makeEditable(edFocal, 'focal');

let activeToasts = [];
function showToast(message) {
  const container = $('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  const svgMarkup = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  toast.innerHTML = `${svgMarkup}<span>${message}</span>`;
  container.appendChild(toast);
  activeToasts.push(toast);
  
  const type = message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') ? 'error' : 'success';
  invoke('trigger_macos_sound', { name: type }).catch(()=>{});

  const updateStack = () => {
    activeToasts.forEach((t, i) => {
      const offset = (activeToasts.length - 1 - i) * 44;
      t.style.transform = `translateY(${-offset}px)`;
    });
  };
  updateStack();

  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => {
      activeToasts = activeToasts.filter(t => t !== toast);
      toast.remove();
      updateStack();
    }, 300);
  }, 3000);
}

function openSettings() { $('settingsModal').style.display = 'flex'; }
function closeSettings() { $('settingsModal').style.display = 'none'; }

function updateCursorVisibility() {
  const shouldShowNative = !useCustomCursor || trafficLightHover;
  document.body.classList.toggle('force-native-cursor', shouldShowNative);
  getCurrentWindow().setCursorVisible(shouldShowNative).catch(() => {});
  if (customCursor) customCursor.style.opacity = shouldShowNative ? 0 : 1;
}

function setTrafficLightHover(active) {
  if (trafficLightHover === active) return;
  trafficLightHover = active;
  updateCursorVisibility();
}
updateCursorVisibility();

async function syncFullscreenState() {
  try { isFullscreen = await getCurrentWindow().isFullscreen(); } catch { isFullscreen = false; }
  if (isFullscreen && trafficLightHover) { trafficLightHover = false; updateCursorVisibility(); }
  if (fullscreenBtn) {
    fullscreenBtn.classList.toggle('active', isFullscreen);
    fullscreenBtn.textContent = isFullscreen ? 'EXIT' : 'FULL';
  }
}

async function toggleFullscreen() {
  try { await getCurrentWindow().setFullscreen(!isFullscreen); await syncFullscreenState(); } catch (err) { console.error(err); }
}

/* ── Viewport & Zoom/Pan ── */
function getActiveImage() { return media.querySelector('.media-layer.media-active img.media-content'); }

function scheduleUpdate() {
  if (pendingRafUpdate) return; pendingRafUpdate = true;
  requestAnimationFrame(() => {
    pendingRafUpdate = false;
    const img = getActiveImage();
    if (img) {
      const t = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
      img.style.transform = t;
      if (editPreviewImg && editPreviewImg.parentElement === img.parentElement) editPreviewImg.style.transform = t;
    }
  });
}



function setZoom(level, cx, cy, opts = {}) {
  const oldZ = zoom;
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, level));
  const img = getActiveImage();
  if (img) {
    if (zoom <= 1.01) {
      zoom = 1; panX = 0; panY = 0;
      img.classList.remove('zoomed'); img.style.transform = '';
      if (editPreviewImg) editPreviewImg.style.transform = '';
    } else {
      img.classList.add('zoomed');
      if (cx !== undefined && cy !== undefined) {
        const ratio = zoom / oldZ;
        panX = cx - (cx - panX) * ratio;
        panY = cy - (cy - panY) * ratio;
      }
      scheduleUpdate();
    }
  }
  zoomSlider.value = Math.round(zoom * 100);
  zoomLabel.textContent = Math.round(zoom * 100) + '%';
}

function resetZoom() { setZoom(1, 0, 0, { smooth: false }); }
async function renderRecentFolders() {
  const container = $('recentFolders');
  if (!container) return;
  if (!showRecentFolders) {
    container.innerHTML = '';
    return;
  }

  try {
    const list = await invoke('get_recent_folders');
    if (!list || list.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = '<div class="recents-title">Recent Folders</div>';
    list.forEach(path => {
      const card = document.createElement('div');
      card.className = 'recent-card';
      const name = path.split('/').pop() || path;
      card.innerHTML = `
        <span class="recent-name">${name}</span>
        <span class="recent-path">${path}</span>
      `;
      card.addEventListener('click', async () => {
        try {
          const p = await invoke('open_specific_folder', { path });
          loadFolderData(p);
        } catch (e) {
          showToast('Failed to open recent folder');
          console.error(e);
        }
      });
      container.appendChild(card);
    });
  } catch (e) {
    console.error('[Folio] Failed to fetch recents:', e);
  }
}

async function loadFolderData(p) {
  items = await invoke('get_folder_items');
  idx = 0; sortItems();
  welcome.classList.add('hidden');
  sidebar.style.display = viewer.style.display = 'flex';
  renderBreadcrumbs(p);
  show(idx);
  invoke('trigger_macos_sound', { name: 'load' }).catch(()=>{});
}

function renderBreadcrumbs(path) {
  if (!breadcrumbs) return;
  breadcrumbs.innerHTML = '';
  const parts = path.split('/').filter(Boolean);
  let currentAccum = '';
  if (path.startsWith('/')) currentAccum = '/';

  parts.forEach((p, i) => {
    const crumb = document.createElement('span');
    crumb.className = 'crumb';
    crumb.textContent = p;
    currentAccum += p;
    const target = currentAccum;
    crumb.onclick = async () => {
        try {
            const res = await invoke('open_specific_folder', { path: target });
            loadFolderData(res);
        } catch(e) { console.error(e); }
    };
    breadcrumbs.appendChild(crumb);
    if (i < parts.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '›';
        breadcrumbs.appendChild(sep);
    }
    currentAccum += '/';
  });
}

/* ── Core Logic ── */
async function openFolder() {
    try {
        const p = await invoke('open_folder_picker');
        if (!p) return;
        await invoke('add_recent_folder', { path: p });
        renderRecentFolders();
        loadFolderData(p);
    } catch (e) { console.error(e); }
}


function nav(dir) { if (items.length) show((idx + dir + items.length) % items.length, dir); }

function clearMediaContent(keep = null) {
  Array.from(media.children).forEach(c => { if (c !== mediaLoader && c !== keep) c.remove(); });
}

function applyPhysicalExit(node, dir) {
  node.classList.remove('media-active');
  node.style.zIndex = '1';
  node.animate([
    { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1) rotate(0deg)' },
    { opacity: 0, transform: `translate3d(${dir * -60}px, 0, 0) scale(0.97) rotate(${dir * -1}deg)` }
  ], { duration: 700, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }).finished.then(() => node.remove());
}

function preloadImage(item) {
  if (!item || item.is_video) return;
  if (preloadCache.has(item.path)) return;

  const ext = (item.path.split('.').pop() || '').toLowerCase();
  const isNative = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext);

  const img = new Image();
  preloadCache.set(item.path, img);

  if (isNative) {
    img.src = `folio://localhost/${encodeURIComponent(item.path)}`;
  } else {
    invoke('get_full_image', { path: item.path })
      .then(p => {
        img.src = `folio://localhost/${encodeURIComponent(p)}`;
      })
      .catch(e => {
        preloadCache.delete(item.path);
        console.error('RAW preload failed:', e);
      });
  }
}

function triggerPreload(currentIdx) {
  if (!items || items.length <= 1) return;

  const keepSet = new Set();
  const windowSize = 2; // Keep 2 adjacent in each direction
  
  for (let offset = -windowSize; offset <= windowSize; offset++) {
    const targetIdx = (currentIdx + offset + items.length) % items.length;
    const item = items[targetIdx];
    if (item && !item.is_video) {
      keepSet.add(item.path);
      if (offset !== 0) {
        preloadImage(item);
      }
    }
  }

  // Evict items from preloadCache that are not in our sliding keep window
  for (const path of preloadCache.keys()) {
    if (!keepSet.has(path)) {
      preloadCache.delete(path);
    }
  }
}

function show(i, dir = null) {
  const prevIdx = idx, direction = dir !== null ? dir : (i > prevIdx ? 1 : i < prevIdx ? -1 : 0);
  idx = i; zoom = 1; panX = 0; panY = 0;
  zoomSlider.value = 100; zoomLabel.textContent = '100%';
  
  const item = items[i], src = `folio://localhost/${encodeURIComponent(item.path)}`, outgoing = media.querySelector('.media-layer.media-active');
  if (outgoing) { if (cinematicEnabled && direction !== 0) applyPhysicalExit(outgoing, direction); else outgoing.remove(); }
  clearMediaContent(outgoing);
  
  const layer = document.createElement('div'); layer.className = 'media-layer media-active';
  layer.style.zIndex = '2';
  
  if (cinematicEnabled && direction !== 0) {
    requestAnimationFrame(() => layer.animate([
        { opacity: 0, transform: `translate3d(${direction * 50}%, 0, 0) scale(1.02) rotate(${direction * 1.5}deg)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1) rotate(0deg)' }
    ], { duration: 750, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }));
  } else {
    layer.style.opacity = '1';
    layer.style.transform = 'none';
  }
  
  if (item.is_video) {
    viewer.classList.remove('loading');
    const v = document.createElement('video');
    v.className = 'media-content';
    v.autoplay = true; v.loop = true; v.playsInline = true; v.src = src;
    v.onloadeddata = () => {
      v.classList.add('loaded');
      const ctrl = document.createElement('div');
      ctrl.className = 'video-controls';
      ctrl.innerHTML = `<button class="v-play-btn">⏸</button><input type="range" class="v-progress" value="0" min="0" max="100"><span class="v-time">0:00</span>`;
      const playBtn = ctrl.querySelector('.v-play-btn'), progress = ctrl.querySelector('.v-progress'), time = ctrl.querySelector('.v-time');
      playBtn.onclick = () => { if (v.paused) { v.play(); playBtn.textContent = '⏸'; } else { v.pause(); playBtn.textContent = '▶'; } };
      v.ontimeupdate = () => { const p = (v.currentTime / v.duration) * 100; progress.value = p; const mins = Math.floor(v.currentTime / 60), secs = Math.floor(v.currentTime % 60); time.textContent = `${mins}:${secs.toString().padStart(2, '0')}`; };
      progress.oninput = () => { v.currentTime = (progress.value / 100) * v.duration; };
      layer.appendChild(ctrl);
      updateAdaptiveGlow(v);
    };
    layer.appendChild(v);
    media.appendChild(layer);
  } else {
    viewer.classList.add('loading'); const ts = preloadedThumbs.get(item.path);
    if (ts) { const ph = document.createElement('img'); ph.crossOrigin = "anonymous"; ph.src = ts; ph.className = 'placeholder-thumb loaded'; layer.appendChild(ph); }
    const img = document.createElement('img'); img.crossOrigin = "anonymous"; img.alt = ''; img.className = 'media-content';
    const onImgReady = () => {
        img.classList.add('loaded');
        img.style.opacity = '1';
        viewer.classList.remove('loading');
        const ph = layer.querySelector('.placeholder-thumb');
        if (ph) ph.remove();
        try {
            updateAdaptiveGlow(img);
        } catch (e) {
            console.error("Adaptive glow error:", e);
        }
        if (editPanelOpen) invoke('prepare_edit_preview', { path: item.path }).then(() => loadEditForCurrent()).catch(e => console.error(e));
        if (overlayVisible) {
            try {
                drawHistogram(img);
            } catch (e) {
                console.error("Histogram error:", e);
            }
            try {
                drawDominantColors(item);
            } catch (e) {
                console.error("Dominant colors error:", e);
            }
        }
    };
    img.onload = onImgReady;
    img.onerror = onImgReady;

    const cached = preloadCache.get(item.path);
    if (cached && cached.complete && cached.naturalWidth > 0) {
        img.src = cached.src;
        onImgReady();
    } else {
        const isNative = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(item.path.split('.').pop().toLowerCase());
        if (isNative) {
            img.src = src;
        } else {
            invoke('get_full_image', { path: item.path })
                .then(p => { img.src = `folio://localhost/${encodeURIComponent(p)}`; })
                .catch(() => { img.src = src; });
        }
    }
    layer.appendChild(img);
    media.appendChild(layer);
  }

  // Update UI Chrome
  counter.textContent = `${i + 1} of ${items.length}`;
  fname.textContent = item.path.split('/').pop();
  dims.textContent = `${item.width} × ${item.height}`;
  badge.style.display = 'inline-block';
  badge.textContent = (item.path.split('.').pop() || '').toUpperCase();
  badge.className = `format-badge fmt-${badge.textContent.toLowerCase()}`;
  
  if (item.exif) {
    edCamera.textContent = item.exif.camera || 'Unknown Camera';
    edAperture.textContent = item.exif.aperture || '—';
    edShutter.textContent = item.exif.shutter_speed || '—';
    edIso.textContent = item.exif.iso || '—';
    edFocal.textContent = item.exif.focal_length || '—';
    const isRaw = !['jpg','jpeg','png','webp'].includes(item.path.split('.').pop().toLowerCase());
    if (isRaw && edTechData) { edTechData.style.display = 'block'; edTechData.innerHTML = `<span>Format: ${badge.textContent}</span><span>Bit Depth: 14-bit</span>`; }
    else if (edTechData) edTechData.style.display = 'none';
  } else {
    edCamera.textContent = 'No Metadata'; edAperture.textContent = edShutter.textContent = edIso.textContent = edFocal.textContent = '—';
    if (edTechData) edTechData.style.display = 'none';
  }
  
  highlightThumb();
  closeCropMode();
  removeEditPreview();
  triggerPreload(i);
}

function updateAdaptiveGlow(el) {
  if (!backdropGlow) return;
  try {
    const color = extractDominantColor(el);
    const rgb = color.match(/\d+/g);
    if (rgb && rgb.length >= 3) {
      const r = parseInt(rgb[0]), g = parseInt(rgb[1]), b = parseInt(rgb[2]);
      const c1 = `rgba(${r}, ${g}, ${b}, 0.22)`;
      const c2 = `rgba(${g}, ${b}, ${r}, 0.16)`;
      const c3 = `rgba(${b}, ${r}, ${g}, 0.12)`;
      
      backdropGlow.style.setProperty('--glow-c1', c1);
      backdropGlow.style.setProperty('--glow-c2', c2);
      backdropGlow.style.setProperty('--glow-c3', c3);
    }
  } catch (e) {
    console.error("Glow generation failed:", e);
  }
}

/* ── Filmstrip ── */
const THUMB_CONCURRENCY = 12; let thumbQueue = [], thumbActive = 0, thumbMaxSide = 320;
function enqueueThumb(el, p) { thumbQueue.push({ el, path: p, retries: 0 }); processThumbQueue(); }
async function processThumbQueue() { while (thumbActive < THUMB_CONCURRENCY && thumbQueue.length > 0) { const j = thumbQueue.shift(); thumbActive++; loadThumb(j).finally(() => { thumbActive--; processThumbQueue(); }); } }
async function loadThumb({ el, path, retries }) {
  const fallback = () => {
    const img = el.querySelector('img');
    if (img) {
      img.onload = () => img.classList.add('loaded');
      img.onerror = () => img.classList.add('loaded'); // Show something even if it fails
      img.src = `folio://localhost/${encodeURIComponent(path)}`;
    }
  };

  try {
    const tp = await invoke('get_thumbnail', { path, maxSide: thumbMaxSide });
    const u = `folio://localhost/${encodeURIComponent(tp)}`;
    const img = el.querySelector('img');
    if (img) {
      img.onload = () => img.classList.add('loaded');
      img.onerror = fallback;
      img.src = u;
    }
    preloadedThumbs.set(path, u);
  } catch (err) {
    if (retries < 2) {
      await new Promise(r => setTimeout(r, 500));
      thumbQueue.push({ el, path, retries: retries + 1 });
    } else {
      fallback();
    }
  }
}
const obs = new IntersectionObserver((entries) => {
  for (const en of entries) { if (en.isIntersecting && !en.target.dataset.loaded) { en.target.dataset.loaded = '1'; enqueueThumb(en.target, en.target.dataset.path); obs.unobserve(en.target); } }
}, { root: filmstrip, rootMargin: '1000px 0px' });

function buildFilmstrip() {
  obs.disconnect(); filmstrip.innerHTML = '';
  filmstrip.classList.toggle('grid-view', gridView);
  gridToggleBtn?.classList.toggle('active', gridView);
  
  items.forEach((it, i) => {
    const d = document.createElement('div'); d.className = i === idx ? 'thumb active' : 'thumb'; d.dataset.path = it.path;
    d.onclick = () => show(i, i === idx ? 0 : (i > idx ? 1 : -1));
    
    if (it.is_video) {
        const v = document.createElement('video');
        v.muted = true; v.loop = true; v.playsInline = true;
        d.appendChild(v);
        
        d.addEventListener('mouseenter', () => { if (!v.src) v.src = `folio://localhost/${encodeURIComponent(it.path)}`; v.play().catch(()=>{}); });
        d.addEventListener('mouseleave', () => { v.pause(); });
        
        const icon = document.createElement('div');
        icon.className = 'vid-icon-small';
        icon.innerHTML = '▶';
        d.appendChild(icon);
    } else {
        const img = document.createElement('img'); img.crossOrigin = "anonymous"; d.appendChild(img);
    }
    
    const dotsContainer = document.createElement('div');
    dotsContainer.className = 'thumb-tag-dots';
    d.appendChild(dotsContainer);
    
    invoke('get_image_tags', { path: it.path }).then(tags => {
      tags.forEach(t => {
        const dot = document.createElement('div');
        dot.className = 'thumb-tag-dot';
        dot.style.background = t.color;
        dot.title = t.name;
        dotsContainer.appendChild(dot);
      });
    }).catch(()=>{});
    
    filmstrip.appendChild(d); obs.observe(d);
  });
}

function highlightThumb() { document.querySelectorAll('.thumb').forEach((t, i) => { if (i === idx) { t.classList.add('active'); filmstrip.scrollTo({ top: t.offsetTop - filmstrip.clientHeight/2 + t.clientHeight/2, behavior: 'smooth' }); } else t.classList.remove('active'); }); }

/* ── Simple Edit Engine ── */
const defaultEdit = () => ({ brightness: 0, vibrance: 0, flip_h: false, flip_v: false, rotate: 0 });
function getCurrentEdit() { return editMap.get(items[idx]?.path) || defaultEdit(); }
function setCurrentEdit(edit) { if (items[idx]?.path) { editMap.set(items[idx].path, edit); invoke('set_edit', { path: items[idx].path, edit }).catch(() => {}); } }

async function openEditPanel() {
  const path = items[idx]?.path; if (!path || items[idx]?.is_video) return;
  editPanelOpen = true; editPanel.classList.add('visible'); editPanel.setAttribute('aria-hidden', 'false'); editToggleBtn.classList.add('active');
  requestAnimationFrame(() => { if (zoom <= 1) resetZoom(); else scheduleUpdate(); });
  try { await invoke('prepare_edit_preview', { path }); loadEditForCurrent(); } catch (e) { console.error(e); }
}

let cropModeActive = false;
let cropCoords = { x: 0, y: 0, w: 1, h: 1 };

function closeCropMode() {
  cropModeActive = false;
  cropBtn?.classList.remove('active');
  const overlay = document.getElementById('cropOverlay');
  if (overlay) overlay.remove();
}

function initCropOverlay() {
  const activeImg = getActiveMediaImg();
  if (!activeImg) return;
  
  let overlay = document.getElementById('cropOverlay');
  if (overlay) overlay.remove();
  
  overlay = document.createElement('div');
  overlay.id = 'cropOverlay';
  overlay.className = 'crop-overlay-container';
  
  for (let i = 1; i <= 2; i++) {
    const hLine = document.createElement('div');
    hLine.className = `crop-grid-line crop-grid-h${i}`;
    overlay.appendChild(hLine);
    
    const vLine = document.createElement('div');
    vLine.className = `crop-grid-line crop-grid-v${i}`;
    overlay.appendChild(vLine);
  }
  
  const hud = document.createElement('div');
  hud.id = 'cropHud';
  hud.className = 'crop-badge-hud';
  hud.textContent = 'Crop Area';
  overlay.appendChild(hud);
  
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  handles.forEach(h => {
    const handle = document.createElement('div');
    handle.className = `crop-handle crop-handle-${h}`;
    handle.dataset.handle = h;
    overlay.appendChild(handle);
  });
  
  const layer = media.querySelector('.media-layer.media-active');
  if (layer) {
    layer.appendChild(overlay);
    updateCropOverlayStyles(activeImg, overlay);
    setupCropEvents(activeImg, overlay);
  }
}

function getActiveMediaImg() {
  const layer = media.querySelector('.media-layer.media-active');
  return layer ? layer.querySelector('.media-content') : null;
}

function updateCropOverlayStyles(img, overlay) {
  if (!img || !overlay) return;
  const w = img.clientWidth;
  const h = img.clientHeight;
  
  const left = cropCoords.x * w;
  const top = cropCoords.y * h;
  const width = cropCoords.w * w;
  const height = cropCoords.h * h;
  
  overlay.style.left = `${img.offsetLeft + left}px`;
  overlay.style.top = `${img.offsetTop + top}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
  
  const activeItem = items[idx];
  if (activeItem) {
    const realW = Math.round(cropCoords.w * activeItem.width);
    const realH = Math.round(cropCoords.h * activeItem.height);
    const hud = document.getElementById('cropHud');
    if (hud) hud.textContent = `${realW} × ${realH} (${Math.round(cropCoords.w * 100)}% × ${Math.round(cropCoords.h * 100)}%)`;
  }
}

function setupCropEvents(img, overlay) {
  let isDraggingCrop = false;
  let dragStart = { x: 0, y: 0 };
  let initialCoords = { ...cropCoords };
  let activeHandle = null;
  
  const onMouseDown = (e) => {
    e.stopPropagation();
    isDraggingCrop = true;
    dragStart = { x: e.clientX, y: e.clientY };
    initialCoords = { ...cropCoords };
    
    if (e.target.classList.contains('crop-handle')) {
      activeHandle = e.target.dataset.handle;
    } else {
      activeHandle = 'move';
    }
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };
  
  const onMouseMove = (e) => {
    if (!isDraggingCrop) return;
    e.preventDefault();
    
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    
    const w = img.clientWidth;
    const h = img.clientHeight;
    
    const rdx = dx / w;
    const rdy = dy / h;
    
    let nextCoords = { ...initialCoords };
    
    if (activeHandle === 'move') {
      nextCoords.x = Math.max(0, Math.min(1 - initialCoords.w, initialCoords.x + rdx));
      nextCoords.y = Math.max(0, Math.min(1 - initialCoords.h, initialCoords.y + rdy));
    } else {
      if (activeHandle.includes('w')) {
        const newW = Math.max(0.05, initialCoords.w - rdx);
        const newX = initialCoords.x + (initialCoords.w - newW);
        if (newX >= 0) {
          nextCoords.w = newW;
          nextCoords.x = newX;
        }
      }
      if (activeHandle.includes('e')) {
        nextCoords.w = Math.max(0.05, Math.min(1 - initialCoords.x, initialCoords.w + rdx));
      }
      if (activeHandle.includes('n')) {
        const newH = Math.max(0.05, initialCoords.h - rdy);
        const newY = initialCoords.y + (initialCoords.h - newH);
        if (newY >= 0) {
          nextCoords.h = newH;
          nextCoords.y = newY;
        }
      }
      if (activeHandle.includes('s')) {
        nextCoords.h = Math.max(0.05, Math.min(1 - initialCoords.y, initialCoords.h + rdy));
      }
    }
    
    cropCoords = nextCoords;
    updateCropOverlayStyles(img, overlay);
    
    const currentEdit = getCurrentEdit();
    currentEdit.crop_x = cropCoords.x;
    currentEdit.crop_y = cropCoords.y;
    currentEdit.crop_w = cropCoords.w;
    currentEdit.crop_h = cropCoords.h;
    setCurrentEdit(currentEdit);
    
    applyEditPreview(currentEdit);
  };
  
  const onMouseUp = () => {
    isDraggingCrop = false;
    activeHandle = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };
  
  overlay.addEventListener('mousedown', onMouseDown);
}

function closeEditPanel() {
  editPanelOpen = false;
  editPanel.classList.remove('visible');
  editPanel.setAttribute('aria-hidden', 'true');
  editToggleBtn.classList.remove('active');
  closeCropMode();
  removeEditPreview();
  requestAnimationFrame(() => { if (zoom <= 1) resetZoom(); else scheduleUpdate(); });
}

function loadEditForCurrent() {
  const e = getCurrentEdit();
  cropCoords = {
    x: e.crop_x ?? 0,
    y: e.crop_y ?? 0,
    w: e.crop_w ?? 1,
    h: e.crop_h ?? 1
  };
  
  if (cropModeActive) {
    initCropOverlay();
  }
  
  document.querySelectorAll('.edit-slider').forEach(s => {
    const v = e[s.dataset.param] ?? 0; s.value = v;
    const valEl = s.closest('.edit-row')?.querySelector('.edit-val');
    if (valEl) valEl.textContent = Math.round(v);
  });
  flipHBtn?.classList.toggle('active', e.flip_h);
  flipVBtn?.classList.toggle('active', e.flip_v);
  if (rotateBtn) {
    rotateBtn.classList.toggle('active', e.rotate !== 0);
    rotateBtn.textContent = e.rotate !== 0 ? `Rotated ${e.rotate}°` : 'Rotate 90°';
  }
  applyEditPreview(e);
}

function removeEditPreview() { if (editPreviewImg) { editPreviewImg.remove(); editPreviewImg = null; } }

async function applyEditPreview(edit) {
  const path = items[idx]?.path; if (!path || !editPanelOpen) return;
  const layer = media.querySelector('.media-layer.media-active'); if (!layer) return;
  clearTimeout(editDebounceTimer);
  editDebounceTimer = setTimeout(async () => {
    try {
      const b64 = await invoke('edit_image', { path, edit });
      if (!editPreviewImg) {
        editPreviewImg = document.createElement('img');
        editPreviewImg.crossOrigin = "anonymous";
        editPreviewImg.className = 'media-content edit-preview loaded';
        editPreviewImg.style.cssText = 'position:absolute;inset:0;margin:auto;z-index:2;width:100%;height:100%;object-fit:contain;pointer-events:none;';
        layer.appendChild(editPreviewImg);
      }
      editPreviewImg.src = 'data:image/jpeg;base64,' + b64;
    } catch (e) { console.error(e); }
  }, 16);
}

/* ── Interactive Listeners ── */
$('openBtn').addEventListener('click', openFolder);
$('openBtn2').addEventListener('click', openFolder);
$('prev').addEventListener('click', () => nav(-1));
$('next').addEventListener('click', () => nav(1));
$('settingsClose').addEventListener('click', closeSettings);
$('settingsBg').addEventListener('click', closeSettings);
zoomSlider?.addEventListener('input', (e) => setZoom(parseInt(e.target.value) / 100, 0, 0));
zoomReset?.addEventListener('click', resetZoom);
fullscreenBtn?.addEventListener('click', toggleFullscreen);

sidebarToggle.addEventListener('click', () => {
  const visible = sidebar.style.display !== 'none';
  sidebar.style.display = visible ? 'none' : 'flex';
  sidebarToggle.classList.toggle('active', !visible);
  sidebarToggle.classList.toggle('sidebar-closed', visible);
  sidebarToggle.textContent = !visible ? 'Close' : 'Sidebar';
  requestAnimationFrame(() => { if (zoom > 1) scheduleUpdate(); else resetZoom(); });
});

gridToggleBtn?.addEventListener('click', () => {
  gridView = !gridView;
  localStorage.setItem('folio_grid_view', gridView);
  buildFilmstrip();
});

let isResizingSidebar = false;
sidebarResizer.addEventListener('mousedown', (e) => {
  isResizingSidebar = true;
  document.body.style.cursor = 'ew-resize';
  sidebarResizer.classList.add('dragging');
});

window.addEventListener('mousemove', (e) => {
  if (!isResizingSidebar) return;
  const newWidth = Math.min(450, Math.max(180, e.clientX));
  document.documentElement.style.setProperty('--sidebar-w', `${newWidth}px`);
});

window.addEventListener('mouseup', () => {
  if (isResizingSidebar) {
    isResizingSidebar = false;
    document.body.style.cursor = '';
    sidebarResizer.classList.remove('dragging');
  }
});

editToggleBtn.addEventListener('click', () => { if (editPanelOpen) closeEditPanel(); else openEditPanel(); });
editCloseBtn?.addEventListener('click', closeEditPanel);
editResetBtn.addEventListener('click', () => { const p = items[idx]?.path; if (!p) return; editMap.set(p, defaultEdit()); loadEditForCurrent(); showToast('Edit reset'); });

flipHBtn.addEventListener('click', () => { const e = getCurrentEdit(); e.flip_h = !e.flip_h; setCurrentEdit(e); loadEditForCurrent(); });
rotateBtn.addEventListener('click', () => { const e = getCurrentEdit(); e.rotate = (e.rotate + 90) % 360; setCurrentEdit(e); loadEditForCurrent(); });
flipVBtn.addEventListener('click', () => { const e = getCurrentEdit(); e.flip_v = !e.flip_v; setCurrentEdit(e); loadEditForCurrent(); });
cropBtn.addEventListener('click', () => {
  cropModeActive = !cropModeActive;
  cropBtn.classList.toggle('active', cropModeActive);
  if (cropModeActive) {
    initCropOverlay();
  } else {
    const overlay = document.getElementById('cropOverlay');
    if (overlay) overlay.remove();
  }
});

editExportBtn?.addEventListener('click', async () => {
  const p = items[idx]?.path; if (!p) return;
  try {
    const dest = await save({ defaultPath: p.replace(/(\\.[^.]+)\$/, '_edited$1'), filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'tiff'] }] });
    if (dest) { await invoke('export_edited', { path: p, dest, stripMetadata: stripMetadataEnabled }); showToast('Exported successfully'); }
  } catch (e) { showToast('Export failed'); }
});

document.querySelectorAll('.edit-slider').forEach(s => {
  s.addEventListener('input', () => {
    const val = parseFloat(s.value);
    const valEl = s.closest('.edit-row')?.querySelector('.edit-val');
    if (valEl) valEl.textContent = Math.round(val);
    const e = getCurrentEdit(); e[s.dataset.param] = val; setCurrentEdit(e); applyEditPreview(e);
  });
});

/* ── Global Handlers ── */
let cursorX = 0, cursorY = 0;
let targetX = 0, targetY = 0;
let isHoveringCursor = false;

window.addEventListener('mousemove', (e) => {
  targetX = e.clientX;
  targetY = e.clientY;
  
  const inTL = !isFullscreen && e.clientX <= 80 && e.clientY <= 40;
  if (useCustomCursor) setTrafficLightHover(inTL);
  
  isHoveringCursor = !!e.target.closest('button, .thumb, input, select, .welcome-btn, .sidebar-dragbar, .sidebar-toggle, .grid-toggle-btn');
});

function updateCursorLoop() {
  if (useCustomCursor && !trafficLightHover) {
    // ProMotion continuous lerp interpolation
    cursorX += (targetX - cursorX) * 0.28;
    cursorY += (targetY - cursorY) * 0.28;
    
    if (customCursor) {
      customCursor.style.opacity = 1;
      customCursor.style.transform = `translate(${cursorX}px, ${cursorY}px)`;
      customCursor.classList.toggle('hovering', isHoveringCursor);
    }
  } else {
    if (customCursor) customCursor.style.opacity = 0;
  }
  requestAnimationFrame(updateCursorLoop);
}
requestAnimationFrame(updateCursorLoop);

media.addEventListener('wheel', (e) => {
  const img = getActiveImage(); if (!img) return;
  
  if (e.ctrlKey) {
    // Native Trackpad Pinch-to-Zoom
    e.preventDefault();
    const scale = Math.exp(-e.deltaY * 0.01);
    setZoom(zoom * scale, e.clientX - media.offsetWidth/2, e.clientY - media.offsetHeight/2);
    return;
  }

  const mod = keybinds.modifierZoom.toLowerCase() + 'Key';
  if (e[mod]) {
    // Keyboard-modifier Scroll Zoom
    e.preventDefault();
    const scale = Math.exp(-(e.deltaY || e.deltaX) * 0.001 * (zoomSens / 5));
    setZoom(zoom * scale, e.clientX - media.offsetWidth/2, e.clientY - media.offsetHeight/2);
  } else if (zoom > 1) {
    // Fluid 2D Panning when zoomed in
    e.preventDefault();
    panX -= e.deltaX;
    panY -= e.deltaY;
    scheduleUpdate();
  }
}, { passive: false });

media.addEventListener('mousedown', async (e) => {
  if (zoom <= 1 && e.button === 0) { if (e.target.closest('video')) return; e.preventDefault(); getCurrentWindow().startDragging(); return; }
  if (zoom > 1) { isDragging = true; startX = e.clientX - panX; startY = e.clientY - panY; }
});
window.addEventListener('mousemove', (e) => { if (isDragging) { panX = e.clientX - startX; panY = e.clientY - startY; scheduleUpdate(); } });
window.addEventListener('mouseup', () => isDragging = false);
media.addEventListener('dblclick', (e) => { if (zoom > 1) resetZoom(); else { const r = media.getBoundingClientRect(); setZoom(2.5, e.clientX - r.left - r.width/2, e.clientY - r.top - r.height/2); } });

window.addEventListener('keydown', (e) => {
    if (['input', 'textarea', 'select'].includes((e.target?.tagName || '').toLowerCase())) return;
    if (e.key === 'ArrowRight') nav(1); if (e.key === 'ArrowLeft') nav(-1);
    if (e.key.toLowerCase() === 'e') editToggleBtn.click();
    if (e.key.toLowerCase() === 't') { e.preventDefault(); showTagPill(); }
    if (e.key.toLowerCase() === 'i') {
        overlayVisible = !overlayVisible;
        edOverlay.classList.toggle('visible', overlayVisible);
        if (overlayVisible) {
            drawHistogram(getActiveImage());
            drawDominantColors(items[idx]);
        }
    }
    if (e.key.toLowerCase() === 'f') toggleFullscreen();
    if (e.key.toLowerCase() === 'b') sidebarToggle.click();
    if (e.key.toLowerCase() === 'z') toggleZenMode();
});

/* ── Drag & Drop ── */
window.addEventListener('dragenter', (e) => e.preventDefault());
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

getCurrentWebview().onDragDropEvent(async (event) => {
  const { type, paths } = event.payload;
  if (type === 'enter' || type === 'over') {
    dropzoneGlow?.classList.add('active');
  } else if (type === 'leave') {
    dropzoneGlow?.classList.remove('active');
  } else if (type === 'drop') {
    dropzoneGlow?.classList.remove('active');
    if (!paths?.length) return;
    try {
      const p = await invoke('open_specific_folder', { path: paths[0] });
      await invoke('add_recent_folder', { path: paths[0] });
      renderRecentFolders();
      loadFolderData(p);
    } catch (err) { console.error(err); }
  }
});

/* ── Histogram & Utilities ── */
function sortItems() {
  const rects = new Map();
  document.querySelectorAll('.thumb').forEach(t => {
    const path = t.dataset.path;
    if (path) rects.set(path, t.getBoundingClientRect());
  });

  if (currentSort === 'date') {
    items.sort((a, b) => (b.modified || 0) - (a.modified || 0));
  } else if (currentSort === 'size') {
    items.sort((a, b) => (b.size || 0) - (a.size || 0));
  } else {
    items.sort((a, b) => a.path.localeCompare(b.path));
  }
  
  buildFilmstrip();

  const newThumbs = document.querySelectorAll('.thumb');
  newThumbs.forEach(t => {
    const path = t.dataset.path;
    if (path && rects.has(path)) {
      const prevRect = rects.get(path);
      const currentRect = t.getBoundingClientRect();
      const dx = prevRect.left - currentRect.left;
      const dy = prevRect.top - currentRect.top;
      if (dx !== 0 || dy !== 0) {
        t.style.transition = 'none';
        t.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      }
    }
  });

  document.body.offsetHeight; // force reflow

  newThumbs.forEach(t => {
    const path = t.dataset.path;
    if (path && rects.has(path)) {
      t.style.transition = 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.45s ease';
      t.style.transform = 'translate3d(0, 0, 0)';
      t.addEventListener('transitionend', () => {
        t.style.transition = '';
        t.style.transform = '';
      }, { once: true });
    }
  });
}
const histogramCanvas = $('histogramCanvas'), histCtx = histogramCanvas?.getContext('2d'), histSample = document.createElement('canvas'), histSampleCtx = histSample.getContext('2d', { willReadFrequently: true });
histSample.width = 256; histSample.height = 256;
function clearHistogram() { if (histCtx) histCtx.clearRect(0, 0, histogramCanvas.width, histogramCanvas.height); }
function drawHistogram(imgEl) {
  if (!histCtx || !imgEl) return; const W = histogramCanvas.width, H = histogramCanvas.height;
  try { histSampleCtx.drawImage(imgEl, 0, 0, 256, 256); } catch (e) { return; }
  const d = histSampleCtx.getImageData(0, 0, 256, 256).data, rB = new Uint32Array(256), gB = new Uint32Array(256), bB = new Uint32Array(256), lB = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { rB[d[i]]++; gB[d[i+1]]++; bB[d[i+2]]++; lB[Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2])]++; }
  let peak = 1; for (let i = 0; i < 256; i++) peak = Math.max(peak, rB[i], gB[i], bB[i]);
  histCtx.clearRect(0, 0, W, H);
  const drawC = (buckets, color) => { histCtx.beginPath(); histCtx.moveTo(0, H); for (let i = 0; i < 256; i++) histCtx.lineTo((i/255)*W, H - (buckets[i]/peak)*H); histCtx.lineTo(W, H); histCtx.fillStyle = color; histCtx.fill(); };
  drawC(rB, 'rgba(255,75,75,0.4)'); drawC(gB, 'rgba(75,210,100,0.4)'); drawC(bB, 'rgba(75,130,255,0.4)'); drawC(lB, 'rgba(255,255,255,0.65)');
}

async function drawDominantColors(item) {
  const container = document.getElementById('paletteChips');
  if (!container) return;
  container.innerHTML = '';
  if (!item || !item.path) return;
  
  try {
    const colors = await invoke('get_dominant_colors', { path: item.path });
    container.innerHTML = '';
    colors.forEach(color => {
      const chip = document.createElement('div');
      chip.className = 'palette-chip';
      chip.style.width = '20px';
      chip.style.height = '20px';
      chip.style.borderRadius = '50%';
      chip.style.background = color;
      chip.style.cursor = 'pointer';
      chip.style.border = '1px solid rgba(255,255,255,0.25)';
      chip.style.transition = 'transform 0.15s ease, box-shadow 0.15s ease';
      chip.setAttribute('data-tooltip', `Copy: ${color}`);
      
      chip.addEventListener('mouseenter', () => {
        chip.style.transform = 'scale(1.25)';
        chip.style.boxShadow = `0 0 6px ${color}`;
      });
      chip.addEventListener('mouseleave', () => {
        chip.style.transform = 'scale(1)';
        chip.style.boxShadow = 'none';
      });
      
      chip.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(color);
          showToast(`Copied ${color} to clipboard!`);
          chip.style.transform = 'scale(1.45)';
          setTimeout(() => {
            chip.style.transform = 'scale(1.25)';
          }, 120);
        } catch (err) {
          showToast('Failed to copy color to clipboard');
        }
      });
      
      container.appendChild(chip);
    });
    initTooltips();
  } catch (e) {
    console.error('Failed to get dominant colors:', e);
  }
}

function extractDominantColor(imgEl) {
  try {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const ctx = c.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, 64, 64);
    const d = ctx.getImageData(0,0,64,64).data;
    let r=0,g=0,b=0;
    for (let i=0; i<d.length; i+=4) { r+=d[i]; g+=d[i+1]; b+=d[i+2]; }
    const count = d.length / 4;
    return `rgba(${Math.floor(r/count)}, ${Math.floor(g/count)}, ${Math.floor(b/count)}, 0.3)`;
  } catch (e) { return 'rgba(255,255,255,0.05)'; }
}

/* ── Init ── */
applyTheme(currentTheme);
renderRecentFolders();
listen('menu-open-folder', openFolder);
listen('menu-settings', openSettings);
if (cinematicCheck) cinematicCheck.checked = cinematicEnabled;
if (themeSelect) themeSelect.value = currentTheme;
if (sortSelect) sortSelect.value = currentSort;
if (zoomSensSlider) zoomSensSlider.value = zoomSens;
if (customCursorCheck) customCursorCheck.checked = useCustomCursor;

/* ── Settings Tab Switching ── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const pane = $('tab-' + btn.dataset.tab);
    if (pane) pane.classList.add('active');
  });
});

/* ── Settings Controls Wiring ── */
if (sortSelect) {
  sortSelect.addEventListener('change', (e) => {
    currentSort = e.target.value;
    localStorage.setItem('folio_sort', currentSort);
    if (items.length) { sortItems(); show(0); }
  });
}

if (themeSelect) {
  themeSelect.addEventListener('change', (e) => {
    currentTheme = e.target.value;
    localStorage.setItem('folio_theme', currentTheme);
    applyTheme(currentTheme);
  });
}

if (cinematicCheck) {
  cinematicCheck.addEventListener('change', (e) => {
    cinematicEnabled = e.target.checked;
    localStorage.setItem('folio_cinematic', cinematicEnabled);
  });
}

if (customCursorCheck) {
  customCursorCheck.addEventListener('change', (e) => {
    useCustomCursor = e.target.checked;
    localStorage.setItem('folio_custom_cursor', useCustomCursor);
    updateCursorVisibility();
  });
}

if (zoomSensSlider) {
  zoomSensSlider.addEventListener('input', (e) => {
    zoomSens = parseFloat(e.target.value);
    localStorage.setItem('folio_zoom_sens', zoomSens);
  });
}

/* ── Keybind Buttons ── */
function keybindLabel(key) {
  const labels = { ' ': 'Space', 'ArrowRight': '→', 'ArrowLeft': '←', 'ArrowUp': '↑', 'ArrowDown': '↓', 'Shift': '⇧ Shift', 'Control': '⌃ Ctrl', 'Alt': '⌥ Alt', 'Meta': '⌘ Cmd' };
  return labels[key] || key.toUpperCase();
}

function populateKeybindButtons() {
  document.querySelectorAll('.keybind-btn').forEach(btn => {
    const action = btn.dataset.action;
    if (action && keybinds[action] !== undefined) {
      btn.textContent = keybindLabel(keybinds[action]);
    }
  });
}
populateKeybindButtons();

$('resetKeybindsBtn')?.addEventListener('click', () => {
  keybinds = { ...defaultKeybinds };
  localStorage.setItem('folio_keybinds', JSON.stringify(keybinds));
  populateKeybindButtons();
  showToast('Keybinds reset to defaults');
});

/* ── Keybind Recording ── */
let activeKeybindBtn = null;
document.querySelectorAll('.keybind-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (activeKeybindBtn) activeKeybindBtn.classList.remove('recording');
    activeKeybindBtn = btn;
    btn.classList.add('recording');
    btn.textContent = 'Press key...';
  });
});

window.addEventListener('keydown', (e) => {
  if (!activeKeybindBtn) return;
  e.preventDefault(); e.stopPropagation();
  const action = activeKeybindBtn.dataset.action;
  const isModifierAction = action === 'modifierZoom' || action === 'modifierPan';
  const key = isModifierAction ? e.key : e.key;
  keybinds[action] = key;
  localStorage.setItem('folio_keybinds', JSON.stringify(keybinds));
  activeKeybindBtn.textContent = keybindLabel(key);
  activeKeybindBtn.classList.remove('recording');
  activeKeybindBtn = null;
}, true);

/* ── Welcome Parallax & Zen Mode ── */
welcome.addEventListener('mousemove', (e) => {
  const w = welcome.clientWidth;
  const h = welcome.clientHeight;
  const x = (e.clientX - w / 2) / (w / 2);
  const y = (e.clientY - h / 2) / (h / 2);
  welcomeBg.style.setProperty('--parallax-x', `${x * -20}px`);
  welcomeBg.style.setProperty('--parallax-y', `${y * -20}px`);
});

let zenModeActive = false;
function toggleZenMode() {
  zenModeActive = !zenModeActive;
  document.body.classList.toggle('zen-mode', zenModeActive);
  sidebar.classList.toggle('zen-hide', zenModeActive);
  document.getElementById('zoomHud')?.classList.toggle('zen-hide', zenModeActive);
  document.getElementById('editToggleBtn')?.classList.toggle('zen-hide', zenModeActive);
  document.getElementById('sidebarToggle')?.classList.toggle('zen-hide', zenModeActive);
  closeCropMode();
  closeEditPanel();
  showToast(zenModeActive ? 'Zen Mode Activated' : 'Zen Mode Deactivated');
}

function showTagPill() {
  let pill = document.getElementById('tagPill');
  if (pill) {
    pill.querySelector('input').focus();
    return;
  }
  
  pill = document.createElement('div');
  pill.id = 'tagPill';
  pill.className = 'glassmorphic-pill-overlay';
  pill.style.position = 'fixed';
  pill.style.top = '40%';
  pill.style.left = '50%';
  pill.style.transform = 'translate(-50%, -50%) scale(0.9)';
  pill.style.opacity = '0';
  pill.style.transition = 'all 0.3s var(--ease-spring)';
  pill.style.zIndex = '9999';
  pill.style.display = 'flex';
  pill.style.alignItems = 'center';
  pill.style.gap = '8px';
  pill.style.padding = '8px 16px';
  pill.style.borderRadius = '30px';
  pill.style.background = 'rgba(20, 20, 20, 0.65)';
  pill.style.backdropFilter = 'blur(20px) saturate(180%)';
  pill.style.border = '1px solid rgba(255,255,255,0.08)';
  pill.style.boxShadow = '0 20px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)';
  
  const icon = document.createElement('span');
  icon.textContent = '🏷️';
  icon.style.fontSize = '14px';
  
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Add tag to current photo...';
  input.style.background = 'none';
  input.style.border = 'none';
  input.style.outline = 'none';
  input.style.color = '#fff';
  input.style.fontSize = '14px';
  input.style.width = '200px';
  input.style.fontFamily = 'inherit';
  
  pill.appendChild(icon);
  pill.appendChild(input);
  document.body.appendChild(pill);
  
  requestAnimationFrame(() => {
    pill.style.transform = 'translate(-50%, -50%) scale(1)';
    pill.style.opacity = '1';
  });
  
  input.focus();
  
  const closePill = () => {
    pill.style.transform = 'translate(-50%, -50%) scale(0.9)';
    pill.style.opacity = '0';
    setTimeout(() => pill.remove(), 250);
  };
  
  input.addEventListener('keydown', async (evt) => {
    if (evt.key === 'Escape') closePill();
    if (evt.key === 'Enter') {
      const tagName = input.value.trim();
      if (!tagName) return;
      
      const item = items[idx];
      if (item) {
        try {
          const colors = ['#D4A72C', '#E55E5E', '#4FA8EE', '#5BC2A8', '#AB6BFA'];
          let hash = 0;
          for (let i = 0; i < tagName.length; i++) hash = tagName.charCodeAt(i) + ((hash << 5) - hash);
          const chosenColor = colors[Math.abs(hash) % colors.length];
          
          await invoke('add_tag_to_image', { path: item.path, tagName, tagColor: chosenColor });
          showToast(`Tagged as "${tagName}"`);
          
          const activeThumb = document.querySelector(`.thumb.active`);
          if (activeThumb) {
            let dotsContainer = activeThumb.querySelector('.thumb-tag-dots');
            if (!dotsContainer) {
              dotsContainer = document.createElement('div');
              dotsContainer.className = 'thumb-tag-dots';
              activeThumb.appendChild(dotsContainer);
            }
            const dot = document.createElement('div');
            dot.className = 'thumb-tag-dot';
            dot.style.background = chosenColor;
            dot.title = tagName;
            dotsContainer.appendChild(dot);
          }
        } catch (e) {
          showToast('Failed to save tag');
        }
      }
      closePill();
    }
  });
  
  const clickOutside = (evt) => {
    if (!pill.contains(evt.target)) {
      closePill();
      document.removeEventListener('mousedown', clickOutside);
    }
  };
  document.addEventListener('mousedown', clickOutside);
}
