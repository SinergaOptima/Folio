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
    <div class="welcome-bg"></div>
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
  </div>

  <div class="viewer" id="viewer" style="display:none">
    <div class="viewer-bg-base"></div>
    <div class="dynamic-bg-tint" id="bgTint"></div>
    <div class="viewer-dragbar" id="vDrag" data-tauri-drag-region></div>
    <div class="media-wrap" id="media"></div>
    
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
          <label for="themeSelect">Theme</label>
          <select id="themeSelect">
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
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
        <div class="sidebar-divider" style="margin: 4px 0"></div>
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

  <div class="update-bar" id="updateBar" style="display:none">
    <span class="update-text" id="updateText"></span>
    <button class="update-action" id="updateAction">Update</button>
    <button class="update-dismiss" id="updateDismiss">×</button>
  </div>

  <div class="custom-cursor" id="customCursor"></div>
`;

const $ = id => document.getElementById(id);
const welcome   = $('welcome');
const sidebar   = $('sidebar');
const viewer    = $('viewer');
const filmstrip = $('filmstrip');
const media     = $('media');
const counter   = $('counter');
const fname     = $('fname');
const dims      = $('dims');
const badge     = $('badge');
const folderLabel = $('folderLabel');
const zoomSlider  = $('zoomSlider');
const zoomLabel   = $('zoomLabel');

/* ── Settings Logic ── */
let currentSort = localStorage.getItem('folio_sort') || 'name';
let zoomSens = parseFloat(localStorage.getItem('folio_zoom_sens')) || 5;
let currentTheme = localStorage.getItem('folio_theme') || 'dark';

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

sortSelect.value = currentSort;
zoomSensSlider.value = zoomSens;
themeSelect.value = currentTheme;

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

sortSelect.addEventListener('change', (e) => {
  currentSort = e.target.value;
  localStorage.setItem('folio_sort', currentSort);
  sortItems();
});
zoomSensSlider.addEventListener('input', (e) => {
  zoomSens = parseFloat(e.target.value);
  localStorage.setItem('folio_zoom_sens', zoomSens);
});
themeSelect.addEventListener('change', (e) => {
  currentTheme = e.target.value;
  localStorage.setItem('folio_theme', currentTheme);
  applyTheme(currentTheme);
});

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

$('resetKeybindsBtn').addEventListener('click', () => {
  keybinds = { ...defaultKeybinds };
  localStorage.setItem('folio_keybinds', JSON.stringify(keybinds));
  updateKeybindsUI();
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

  buildFilmstrip();
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
  setZoom(parseInt(e.target.value) / 100);
});

/* ── Menu event listeners (Tauri IPC) ── */
listen('menu-open-folder', () => {
  openFolder();
}).catch(e => console.error('[Folio] Failed to listen for menu-open-folder:', e));

listen('menu-settings', () => {
  openSettings();
}).catch(e => console.error('[Folio] Failed to listen for menu-settings:', e));

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
  // Escape to close settings
  if (e.key === 'Escape') {
    closeSettings();
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
    const v = media.querySelector('video');
    if (v) v.paused ? v.play() : v.pause();
  }
  else if (k === keybinds.resetZoom.toLowerCase()) { resetZoom(); }
  else if (k === keybinds.toggleMetadata.toLowerCase()) { toggleEditorialOverlay(); }
});

/* ── Zoom/Pan State ── */
let panX = 0, panY = 0;
let isDragging = false, startX, startY;
let pendingRafUpdate = false;

function scheduleUpdate() {
  if (pendingRafUpdate) return;
  pendingRafUpdate = true;
  requestAnimationFrame(() => {
    pendingRafUpdate = false;
    const img = media.querySelector('img');
    if (img) img.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
  });
}

/* ── Shift+Scroll Zoom ── */
media.addEventListener('wheel', (e) => {
  const modProp = keybinds.modifierZoom.toLowerCase() + 'Key';
  if (!e[modProp]) return;
  e.preventDefault();

  const img = media.querySelector('img');
  if (!img) return;

  const delta = e.deltaY || e.deltaX;
  const sensMultiplier = 0.001 * (zoomSens / 5);
  const scale = Math.exp(-delta * sensMultiplier);
  let newZoom = zoom * scale;
  newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));

  if (Math.abs(newZoom - zoom) > 0.001) {
    const rect = media.getBoundingClientRect();
    const cx = e.clientX - rect.left - (rect.width / 2);
    const cy = e.clientY - rect.top - (rect.height / 2);
    setZoom(newZoom, cx, cy);
  }
}, { passive: false });

function setZoom(level, cx, cy) {
  const oldZoom = zoom;
  zoom = level;
  const img = media.querySelector('img');
  if (!img) return;

  zoomSlider.value = Math.round(zoom * 100);
  zoomLabel.textContent = Math.round(zoom * 100) + '%';

  if (zoom <= 1.01) {
    zoom = 1; panX = 0; panY = 0;
    img.classList.remove('zoomed');
    img.style.transform = '';
    media.classList.remove('panning');
    zoomSlider.value = 100;
    zoomLabel.textContent = '100%';
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
}

/* ── Drag Panning & Window Dragging ── */
media.addEventListener('mousedown', async (e) => {
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
  setZoom(1);
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
    folderLabel.textContent = name;
    show(idx);
  } catch (err) { console.error('[Folio] openFolder error:', err); }
}

function nav(dir) {
  if (!items.length) return;
  show((idx + dir + items.length) % items.length);
}

function show(i) {
  idx = i;
  zoom = 1; panX = 0; panY = 0;
  zoomSlider.value = 100;
  zoomLabel.textContent = '100%';
  media.classList.remove('panning');

  const item = items[i];
  const src = `folio://localhost/${encodeURIComponent(item.path)}`;
  media.innerHTML = '';

  if (item.is_video) {
    const v = document.createElement('video');
    v.controls = true; v.autoplay = true; v.loop = true;
    v.playsInline = true; v.src = src;
    v.onloadeddata = () => v.classList.add('loaded');
    media.appendChild(v);
  } else {
    // Show cached thumbnail instantly as blurred placeholder
    const thumbSrc = preloadedThumbs.get(item.path);
    if (thumbSrc) {
      const placeholder = document.createElement('img');
      placeholder.alt = '';
      placeholder.src = thumbSrc;
      placeholder.className = 'placeholder-thumb loaded';
      media.appendChild(placeholder);
    }

    // Load the full-resolution image
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    // Check preload cache first
    const cached = preloadCache.get(item.path);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      img.src = cached.src;
      img.classList.add('loaded');
      // Remove placeholder immediately
      const ph = media.querySelector('.placeholder-thumb');
      if (ph) ph.remove();
    } else {
      img.src = src;
      img.onload = () => {
        img.classList.add('loaded');
        // Fade out placeholder once full image is ready
        const ph = media.querySelector('.placeholder-thumb');
        if (ph) ph.remove();
      };
    }
    media.appendChild(img);
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

function enqueueThumb(el, path) {
  thumbQueue.push({ el, path, retries: 0 });
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

async function loadThumb({ el, path, retries }) {
  try {
    const tp = await invoke('get_thumbnail', { path, maxSide: 160 });
    const thumbUrl = `folio://localhost/${encodeURIComponent(tp)}`;
    const img = el.querySelector('img');
    if (img) {
      img.src = thumbUrl;
      img.onload = () => img.classList.add('loaded');
    }
    // Cache this URL for use as instant placeholder in the main viewer
    cacheThumbUrl(path, thumbUrl);
  } catch (err) {
    if (retries < 2) {
      // Retry after a short delay — thumbnail may still be generating
      await new Promise(r => setTimeout(r, 500));
      thumbQueue.push({ el, path, retries: retries + 1 });
    } else {
      // Final fallback: load original directly
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

    d.addEventListener('click', () => show(i));
    frag.appendChild(d);
    obs.observe(d);
  }
  filmstrip.appendChild(frag);
}

function highlightThumb() {
  const thumbs = filmstrip.querySelectorAll('.thumb');
  thumbs.forEach((t, i) => {
    if (i === idx) {
      t.classList.add('active');
      t.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
getCurrentWindow().setCursorVisible(false).catch(() => {});
const customCursor = $('customCursor');
let cursorVisible = false;

window.addEventListener('mousemove', (e) => {
  if (!cursorVisible) {
    customCursor.style.opacity = 1;
    cursorVisible = true;
  }
  customCursor.style.left = e.clientX + 'px';
  customCursor.style.top = e.clientY + 'px';
  
  // Magnetic effect on interactive elements
  const target = e.target;
  if (target.closest('button, .thumb, input, select, .welcome-btn, .sidebar-dragbar')) {
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

// 3. Fast Canvas-based Color Extraction for Dynamic Tint
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
