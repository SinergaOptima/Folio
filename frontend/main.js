import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/* ── State ── */
let items = [];
let idx = 0;
let zoom = 1;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const win = getCurrentWindow();

/* ── DOM ── */
const app = document.getElementById('app');
app.innerHTML = `
  <div class="welcome" id="welcome">
    <div class="welcome-dragbar" id="wDrag" data-tauri-drag-region></div>
    <div class="welcome-bg"></div>
    <div class="welcome-orb"></div><div class="welcome-orb"></div>
    <div class="welcome-orb"></div><div class="welcome-orb"></div>
    <div class="welcome-content">
      <h1>Folio</h1>
      <p class="tagline">Your photography, undistracted.</p>
      <button class="welcome-btn" id="openBtn"><span>Open Folder</span></button>
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
    <div class="viewer-dragbar" id="vDrag" data-tauri-drag-region></div>
    <div class="media-wrap" id="media"></div>
    <button class="nav-arrow prev" id="prev">‹</button>
    <button class="nav-arrow next" id="next">›</button>
    <div class="zoom-hud" id="zoomHud">
      <input type="range" id="zoomSlider" min="100" max="800" value="100" step="10" />
      <span class="zoom-label" id="zoomLabel">100%</span>
      <button class="zoom-reset" id="zoomReset">FIT</button>
    </div>
  </div>
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

/* ── Events ── */
$('openBtn').addEventListener('click', openFolder);
$('openBtn2').addEventListener('click', openFolder);
$('prev').addEventListener('click', () => nav(-1));
$('next').addEventListener('click', () => nav(1));
$('zoomReset').addEventListener('click', resetZoom);
zoomSlider.addEventListener('input', (e) => {
  setZoom(parseInt(e.target.value) / 100);
});

window.addEventListener('keydown', (e) => {
  if (!items.length) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); nav(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); nav(-1); }
  else if (e.key === 'Home') { e.preventDefault(); show(0); }
  else if (e.key === 'End') { e.preventDefault(); show(items.length - 1); }
  else if (e.key === ' ') {
    e.preventDefault();
    const v = media.querySelector('video');
    if (v) v.paused ? v.play() : v.pause();
  }
  else if (e.key === '0') { resetZoom(); }
});

/* ── State ── */
let panX = 0, panY = 0;
let isDragging = false, startX, startY;

/* ── Shift+Scroll Zoom ── */
media.addEventListener('wheel', (e) => {
  if (!e.shiftKey) return;
  e.preventDefault();

  const img = media.querySelector('img');
  if (!img) return;

  const scale = Math.exp(-e.deltaY * 0.005);
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

    img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }
}

/* ── Drag Panning ── */
media.addEventListener('mousedown', (e) => {
  if (zoom <= 1 || e.button !== 0) return;
  isDragging = true;
  startX = e.clientX - panX;
  startY = e.clientY - panY;
});
window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  panX = e.clientX - startX;
  panY = e.clientY - startY;
  const img = media.querySelector('img');
  if (img) img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
});
window.addEventListener('mouseup', () => isDragging = false);

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
    welcome.classList.add('hidden');
    sidebar.style.display = 'flex';
    viewer.style.display = 'flex';
    folderLabel.textContent = name;
    buildFilmstrip();
    show(0);
  } catch (err) { console.error(err); }
}

function nav(dir) {
  if (!items.length) return;
  show((idx + dir + items.length) % items.length);
}

function show(i) {
  idx = i;
  zoom = 1;
  zoomSlider.value = 100;
  zoomLabel.textContent = '100%';
  media.classList.remove('panning');
  media.scrollTo(0, 0);

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
    const img = document.createElement('img');
    img.alt = ''; img.src = src;
    img.onload = () => img.classList.add('loaded');
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

  highlightThumb();
}

/* ── Filmstrip ── */
const obs = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const el = en.target;
    if (el.dataset.loaded) continue;
    el.dataset.loaded = '1';

    const path = el.dataset.path;
    const isVid = el.dataset.vid === '1';

    if (isVid) {
      // For videos: load via <video>, seek to 1s for a preview frame
      const v = el.querySelector('video');
      if (v) {
        v.src = `folio://localhost/${encodeURIComponent(path)}`;
        v.addEventListener('loadeddata', () => {
          v.currentTime = Math.min(1, v.duration || 0);
        }, { once: true });
      }
    } else {
      // For images/GIFs: generate thumbnail on backend
      invoke('get_thumbnail', { path, maxSide: 160 })
        .then(tp => {
          const img = el.querySelector('img');
          if (img) img.src = `folio://localhost/${encodeURIComponent(tp)}`;
        })
        .catch(() => {
          // Fallback: load original directly
          const img = el.querySelector('img');
          if (img) img.src = `folio://localhost/${encodeURIComponent(path)}`;
        });
    }
    obs.unobserve(el);
  }
}, { root: filmstrip, rootMargin: '400px 0px' });

function buildFilmstrip() {
  obs.disconnect();
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

      // Play icon overlay
      const play = document.createElement('div');
      play.className = 'play-icon';
      play.textContent = '▶';
      d.appendChild(play);

      // Format badge
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
