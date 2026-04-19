/* ================================================================
   PixelForge — Editor Engine
   ================================================================ */

'use strict';

// ─── STATE ──────────────────────────────────────────────────────
const state = {
  canvasW: 800, canvasH: 600,
  zoom: 1,
  tool: 'select',
  fgColor: '#000000',
  bgColor: '#ffffff',
  brushSize: 10,
  brushOpacity: 100,
  layers: [],           // [{id, type, name, visible, locked, opacity, blendMode, x,y,w,h, rotate, data}]
  selectedLayerId: null,
  history: [],
  historyIndex: -1,
  textAlign: 'left',
  isDrawing: false,
  isDragging: false,
  dragStart: null,
  cropStart: null,
  isCropping: false,
  selectedShape: null,
  selectedQuality: 'mid',
  paintCanvas: null,   // off-screen canvas for current paint layer
};

let layerCounter = 0;

// ─── DOM ─────────────────────────────────────────────────────────
const mainCanvas = document.getElementById('mainCanvas');
const ctx = mainCanvas.getContext('2d');
const overlayCanvas = document.getElementById('overlayCanvas');
const octx = overlayCanvas.getContext('2d');
const viewport = document.getElementById('canvasViewport');
const wrapper = document.getElementById('canvasWrapper');

// ─── INIT ─────────────────────────────────────────────────────────
function init() {
  mainCanvas.width = state.canvasW;
  mainCanvas.height = state.canvasH;
  overlayCanvas.width = state.canvasW;
  overlayCanvas.height = state.canvasH;
  wrapper.style.width = state.canvasW + 'px';
  wrapper.style.height = state.canvasH + 'px';
  updateZoom();
  // Add a white background layer
  addLayerBackground('#ffffff');
  renderAll();
  renderLayers();
  saveHistory();
}

// ─── CANVAS RESIZE ─────────────────────────────────────────────
function resizeCanvas(w, h) {
  const snap = exportFlat();
  state.canvasW = w; state.canvasH = h;
  state.layers = [];
  layerCounter = 0;
  mainCanvas.width = w; mainCanvas.height = h;
  overlayCanvas.width = w; overlayCanvas.height = h;
  wrapper.style.width = w + 'px'; wrapper.style.height = h + 'px';
  // Re-add with current as base
  const img = new Image();
  img.onload = () => {
    addImageLayer(img, 'Canvas', 0, 0, w, h);
    renderAll(); renderLayers(); saveHistory();
  };
  img.src = snap;
}

// ─── LAYERS ──────────────────────────────────────────────────────
function makeLayerId() { return 'layer_' + (++layerCounter); }

function addLayerBackground(color) {
  const id = makeLayerId();
  state.layers.unshift({
    id, type: 'fill', name: 'Background',
    visible: true, locked: false,
    opacity: 100, blendMode: 'source-over',
    x: 0, y: 0, w: state.canvasW, h: state.canvasH, rotate: 0,
    color,
  });
  state.selectedLayerId = id;
}

function addImageLayer(imgEl, name = 'Photo', x = 0, y = 0, w, h) {
  const id = makeLayerId();
  const iw = w || imgEl.naturalWidth || imgEl.width;
  const ih = h || imgEl.naturalHeight || imgEl.height;
  // scale to fit canvas if too big
  let fw = iw, fh = ih;
  if (fw > state.canvasW) { fh = Math.round(fh * state.canvasW / fw); fw = state.canvasW; }
  if (fh > state.canvasH) { fw = Math.round(fw * state.canvasH / fh); fh = state.canvasH; }
  const cx = x !== undefined ? x : Math.round((state.canvasW - fw) / 2);
  const cy = y !== undefined ? y : Math.round((state.canvasH - fh) / 2);

  state.layers.push({
    id, type: 'image', name,
    visible: true, locked: false,
    opacity: 100, blendMode: 'source-over',
    x: cx, y: cy, w: fw, h: fh, rotate: 0,
    img: imgEl,
  });
  state.selectedLayerId = id;
  renderAll(); renderLayers();
}

function addTextLayer(opts) {
  const id = makeLayerId();
  state.layers.push({
    id, type: 'text', name: 'Text: ' + opts.content.slice(0, 16),
    visible: true, locked: false,
    opacity: 100, blendMode: 'source-over',
    x: 40, y: 40, w: state.canvasW - 80, h: 0, rotate: 0,
    ...opts,
  });
  state.selectedLayerId = id;
  renderAll(); renderLayers(); saveHistory();
}

function addShapeLayer(opts) {
  const id = makeLayerId();
  const cx = Math.round((state.canvasW - opts.w) / 2);
  const cy = Math.round((state.canvasH - opts.h) / 2);
  state.layers.push({
    id, type: 'shape', name: 'Shape: ' + opts.shape,
    visible: true, locked: false,
    opacity: opts.shapeOpacity || 100, blendMode: 'source-over',
    x: cx, y: cy, rotate: 0,
    ...opts,
  });
  state.selectedLayerId = id;
  renderAll(); renderLayers(); saveHistory();
}

function addPaintLayer() {
  const id = makeLayerId();
  const pc = document.createElement('canvas');
  pc.width = state.canvasW; pc.height = state.canvasH;
  state.layers.push({
    id, type: 'paint', name: 'Paint Layer',
    visible: true, locked: false,
    opacity: 100, blendMode: 'source-over',
    x: 0, y: 0, w: state.canvasW, h: state.canvasH, rotate: 0,
    paintCanvas: pc,
  });
  state.selectedLayerId = id;
  state.paintCanvas = pc;
  return id;
}

function getLayerById(id) { return state.layers.find(l => l.id === id); }

function deleteSelectedLayer() {
  if (!state.selectedLayerId) return;
  const idx = state.layers.findIndex(l => l.id === state.selectedLayerId);
  if (idx < 0) return;
  state.layers.splice(idx, 1);
  state.selectedLayerId = state.layers.length ? state.layers[state.layers.length - 1].id : null;
  renderAll(); renderLayers(); saveHistory();
}

// ─── RENDER ──────────────────────────────────────────────────────
function renderAll() {
  ctx.clearRect(0, 0, state.canvasW, state.canvasH);
  // Checkerboard as canvas BG
  drawCheckerboard(ctx, state.canvasW, state.canvasH);

  for (let i = 0; i < state.layers.length; i++) {
    const layer = state.layers[i];
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity / 100;
    ctx.globalCompositeOperation = layer.blendMode || 'source-over';

    if (layer.rotate) {
      const cx = layer.x + (layer.w || 0) / 2;
      const cy = layer.y + (layer.h || 0) / 2;
      ctx.translate(cx, cy);
      ctx.rotate(layer.rotate * Math.PI / 180);
      ctx.translate(-cx, -cy);
    }

    switch (layer.type) {
      case 'fill':   renderFillLayer(ctx, layer); break;
      case 'image':  renderImageLayer(ctx, layer); break;
      case 'text':   renderTextLayer(ctx, layer); break;
      case 'shape':  renderShapeLayer(ctx, layer); break;
      case 'paint':  renderPaintLayer(ctx, layer); break;
    }
    ctx.restore();
  }
  renderSelection();
}

function drawCheckerboard(c, w, h) {
  const sz = 10;
  for (let y = 0; y < h; y += sz) for (let x = 0; x < w; x += sz) {
    c.fillStyle = ((x / sz + y / sz) % 2 === 0) ? '#cccccc' : '#ffffff';
    c.fillRect(x, y, sz, sz);
  }
}

function renderFillLayer(c, l) {
  c.fillStyle = l.color || '#ffffff';
  c.fillRect(l.x, l.y, l.w, l.h);
}

function renderImageLayer(c, l) {
  if (l.cssFilter) c.filter = l.cssFilter;
  c.drawImage(l.img, l.x, l.y, l.w, l.h);
  c.filter = 'none';
}

function renderTextLayer(c, l) {
  c.save();
  const lines = l.content.split('\n');
  const fs = l.fontSize || 48;
  const fontStr = `${l.fontStyle||'normal'} ${l.fontWeight||'normal'} ${fs}px ${l.fontFamily||'Syne, sans-serif'}`;
  c.font = fontStr;
  c.textAlign = l.textAlign || 'left';
  c.textBaseline = 'top';

  const lineH = fs * (l.lineHeight || 1.2);
  const maxLineW = lines.reduce((m, ln) => Math.max(m, c.measureText(ln).width), 0);
  const totalH = lines.length * lineH;
  const tx = l.x;
  const ty = l.y;

  // BG box
  if (l.bgOpacity > 0) {
    c.save();
    const hex = l.bgColor || '#000000';
    c.fillStyle = hexToRgba(hex, l.bgOpacity / 100);
    const pad = l.bgPad || 8;
    c.fillRect(tx - pad, ty - pad, maxLineW + pad * 2, totalH + pad * 2);
    c.restore();
  }

  // Shadow
  if (l.shadowBlur || l.shadowX || l.shadowY) {
    c.shadowColor = l.shadowColor || '#000000';
    c.shadowBlur = l.shadowBlur || 0;
    c.shadowOffsetX = l.shadowX || 0;
    c.shadowOffsetY = l.shadowY || 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const lx = tx;
    const ly = ty + i * lineH;
    // Stroke
    if (l.strokeSize > 0) {
      c.strokeStyle = l.strokeColor || '#000000';
      c.lineWidth = l.strokeSize;
      c.lineJoin = 'round';
      c.strokeText(lines[i], lx, ly);
    }
    // Fill
    c.fillStyle = l.color || '#ffffff';
    c.fillText(lines[i], lx, ly);
  }
  c.restore();
}

function renderShapeLayer(c, l) {
  c.save();
  c.fillStyle = l.fill || 'transparent';
  c.strokeStyle = l.stroke || '#000000';
  c.lineWidth = l.strokeW || 2;
  c.globalAlpha = (c.globalAlpha * (l.shapeOpacity || 100)) / 100;

  const x = l.x, y = l.y, w = l.w, h = l.h;
  c.beginPath();
  switch (l.shape) {
    case 'rect':
      c.rect(x, y, w, h); break;
    case 'rounded-rect':
      c.roundRect(x, y, w, h, 16); break;
    case 'circle':
      c.arc(x + w/2, y + h/2, Math.min(w,h)/2, 0, Math.PI*2); break;
    case 'ellipse':
      c.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI*2); break;
    case 'triangle':
      c.moveTo(x + w/2, y);
      c.lineTo(x + w, y + h);
      c.lineTo(x, y + h);
      c.closePath(); break;
    case 'star':
      drawStar(c, x + w/2, y + h/2, 5, Math.min(w,h)/2, Math.min(w,h)/4); break;
    case 'line':
      c.moveTo(x, y + h/2); c.lineTo(x + w, y + h/2); break;
    case 'arrow':
      drawArrow(c, x, y + h/2, x + w, y + h/2, h/4); break;
  }
  if (l.fill !== 'transparent') c.fill();
  if (l.strokeW > 0) c.stroke();
  c.restore();
}

function drawStar(c, cx, cy, points, outerR, innerR) {
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI / points) - Math.PI / 2;
    if (i === 0) c.moveTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    else c.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  c.closePath();
}

function drawArrow(c, x1, y1, x2, y2, hw) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = hw * 1.5;
  c.moveTo(x1, y1);
  c.lineTo(x2 - headLen * Math.cos(angle), y2 - headLen * Math.sin(angle));
  c.stroke();
  c.beginPath();
  c.moveTo(x2, y2);
  c.lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4));
  c.lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4));
  c.closePath();
  c.fillStyle = c.strokeStyle;
  c.fill();
}

function renderPaintLayer(c, l) {
  c.drawImage(l.paintCanvas, 0, 0);
}

// ─── SELECTION HANDLES ───────────────────────────────────────────
function renderSelection() {
  octx.clearRect(0, 0, state.canvasW, state.canvasH);
  if (!state.selectedLayerId) return;
  const l = getLayerById(state.selectedLayerId);
  if (!l || l.type === 'fill') return;
  const x = l.x, y = l.y, w = l.w || 100, h = l.h || 40;
  octx.save();
  octx.strokeStyle = '#f0e040';
  octx.lineWidth = 1.5;
  octx.setLineDash([5, 4]);
  octx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  octx.restore();
  // Corner handles
  const corners = [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x+w/2,y],[x+w,y+h/2],[x+w/2,y+h],[x,y+h/2]];
  for (const [hx, hy] of corners) {
    octx.fillStyle = '#0e0e0f';
    octx.fillRect(hx - 5, hy - 5, 10, 10);
    octx.strokeStyle = '#f0e040';
    octx.lineWidth = 1.5;
    octx.setLineDash([]);
    octx.strokeRect(hx - 5, hy - 5, 10, 10);
  }
}

// ─── LAYERS PANEL ────────────────────────────────────────────────
function renderLayers() {
  const list = document.getElementById('layersList');
  list.innerHTML = '';
  const reversed = [...state.layers].reverse();
  for (const layer of reversed) {
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer.id === state.selectedLayerId ? ' selected' : '');
    item.dataset.id = layer.id;

    const thumb = document.createElement('div');
    thumb.className = 'layer-thumb';
    thumb.textContent = layer.type === 'image' ? '🖼' : layer.type === 'text' ? 'T' : layer.type === 'paint' ? '🖌' : layer.type === 'shape' ? '▭' : '🎨';

    const info = document.createElement('div');
    info.className = 'layer-info';
    info.innerHTML = `<div class="layer-name">${layer.name}</div><div class="layer-type">${layer.type}</div>`;

    const vis = document.createElement('div');
    vis.className = 'layer-vis' + (layer.visible ? '' : ' hidden');
    vis.textContent = layer.visible ? '👁' : '◌';
    vis.title = 'Toggle Visibility';
    vis.onclick = (e) => { e.stopPropagation(); layer.visible = !layer.visible; renderAll(); renderLayers(); };

    item.append(thumb, info, vis);
    item.onclick = () => selectLayer(layer.id);
    list.appendChild(item);
  }
  updateLayerProps();
}

function selectLayer(id) {
  state.selectedLayerId = id;
  renderAll();
  renderLayers();
  updateLayerProps();
}

function updateLayerProps() {
  const l = getLayerById(state.selectedLayerId);
  if (!l) return;
  document.getElementById('layerOpacity').value = l.opacity;
  document.getElementById('layerOpacityVal').textContent = l.opacity + '%';
  document.getElementById('layerBlend').value = l.blendMode || 'source-over';
  document.getElementById('layerX').value = Math.round(l.x);
  document.getElementById('layerY').value = Math.round(l.y);
  document.getElementById('layerW').value = Math.round(l.w || 0);
  document.getElementById('layerH').value = Math.round(l.h || 0);
  document.getElementById('layerRotate').value = l.rotate || 0;
  document.getElementById('layerRotateVal').textContent = (l.rotate || 0) + '°';
}

// ─── HISTORY ─────────────────────────────────────────────────────
function saveHistory() {
  const snap = exportFlat();
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snap);
  if (state.history.length > 30) state.history.shift();
  state.historyIndex = state.history.length - 1;
}

function undo() {
  if (state.historyIndex <= 0) return showToast('Nothing to undo', 'error');
  state.historyIndex--;
  restoreFromSnap(state.history[state.historyIndex]);
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return showToast('Nothing to redo', 'error');
  state.historyIndex++;
  restoreFromSnap(state.history[state.historyIndex]);
}

function restoreFromSnap(dataUrl) {
  const img = new Image();
  img.onload = () => {
    state.layers = [];
    layerCounter = 0;
    addImageLayer(img, 'Restored', 0, 0, state.canvasW, state.canvasH);
    renderAll(); renderLayers();
  };
  img.src = dataUrl;
}

// ─── EXPORT ──────────────────────────────────────────────────────
function exportFlat(format = 'png', quality = 1) {
  const tmp = document.createElement('canvas');
  tmp.width = state.canvasW; tmp.height = state.canvasH;
  const tc = tmp.getContext('2d');
  tc.drawImage(mainCanvas, 0, 0);
  return tmp.toDataURL('image/' + format, quality);
}

function downloadImage(format, quality, scale, filename) {
  const sw = Math.round(state.canvasW * scale);
  const sh = Math.round(state.canvasH * scale);
  const tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  const tc = tmp.getContext('2d');
  tc.scale(scale, scale);
  tc.drawImage(mainCanvas, 0, 0);

  const mime = 'image/' + (format === 'jpg' ? 'jpeg' : format);
  const dataUrl = tmp.toDataURL(mime, quality);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename + '.' + format;
  a.click();
  showToast('Download berhasil! 🎉', 'success');
}

// ─── ZOOM ────────────────────────────────────────────────────────
function setZoom(z) {
  state.zoom = Math.max(0.1, Math.min(8, z));
  updateZoom();
}
function updateZoom() {
  wrapper.style.transform = `scale(${state.zoom})`;
  wrapper.style.transformOrigin = 'top left';
  document.getElementById('zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
}
function fitZoom() {
  const vw = viewport.clientWidth - 40;
  const vh = viewport.clientHeight - 40;
  const z = Math.min(vw / state.canvasW, vh / state.canvasH, 1);
  setZoom(z);
}

// ─── MOUSE / TOUCH ───────────────────────────────────────────────
function getCanvasPos(e) {
  const rect = wrapper.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) / state.zoom,
    y: (clientY - rect.top) / state.zoom,
  };
}

let paintLayerId = null;

wrapper.addEventListener('mousedown', onMouseDown);
wrapper.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseup', onMouseUp);
wrapper.addEventListener('touchstart', e => { onMouseDown(e.touches[0] ? e : e); }, { passive: false });
wrapper.addEventListener('touchmove', e => { e.preventDefault(); onMouseMove(e); }, { passive: false });
window.addEventListener('touchend', onMouseUp);

function onMouseDown(e) {
  if (e.button === 2) return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  state.isDrawing = true;
  state.isDragging = false;
  state.dragStart = { ...pos };

  const tool = state.tool;
  if (tool === 'brush' || tool === 'eraser') {
    if (!paintLayerId || !getLayerById(paintLayerId) || getLayerById(paintLayerId).type !== 'paint') {
      paintLayerId = addPaintLayer();
      renderLayers();
    }
    const pc = getLayerById(paintLayerId).paintCanvas;
    const pc2 = pc.getContext('2d');
    pc2.beginPath();
    pc2.moveTo(pos.x, pos.y);
  } else if (tool === 'fill') {
    floodFill(Math.round(pos.x), Math.round(pos.y), state.fgColor);
    saveHistory();
    return;
  } else if (tool === 'select' || tool === 'move') {
    // Check if clicking on selected layer
    const l = getLayerById(state.selectedLayerId);
    if (l) {
      state.isDragging = true;
      state.dragLayerStart = { x: l.x, y: l.y };
    }
    // Hit test layers (top to bottom)
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const layer = state.layers[i];
      if (!layer.visible) continue;
      const lx = layer.x, ly = layer.y, lw = layer.w || 100, lh = layer.h || 40;
      if (pos.x >= lx && pos.x <= lx + lw && pos.y >= ly && pos.y <= ly + lh) {
        selectLayer(layer.id);
        state.dragLayerStart = { x: layer.x, y: layer.y };
        break;
      }
    }
  }
}

function onMouseMove(e) {
  if (!state.isDrawing) return;
  const pos = getCanvasPos(e);
  const tool = state.tool;

  if (tool === 'brush' || tool === 'eraser') {
    const l = getLayerById(paintLayerId);
    if (!l) return;
    const pc = l.paintCanvas;
    const pc2 = pc.getContext('2d');
    pc2.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    pc2.globalAlpha = state.brushOpacity / 100;
    pc2.strokeStyle = state.fgColor;
    pc2.lineWidth = state.brushSize;
    pc2.lineCap = 'round';
    pc2.lineJoin = 'round';
    pc2.lineTo(pos.x, pos.y);
    pc2.stroke();
    pc2.beginPath();
    pc2.moveTo(pos.x, pos.y);
    renderAll();
  } else if ((tool === 'select' || tool === 'move') && state.isDragging) {
    const l = getLayerById(state.selectedLayerId);
    if (!l || l.locked) return;
    l.x = Math.round(state.dragLayerStart.x + pos.x - state.dragStart.x);
    l.y = Math.round(state.dragLayerStart.y + pos.y - state.dragStart.y);
    renderAll();
    updateLayerProps();
  } else if (tool === 'shape' || tool === 'crop') {
    // Preview
    octx.clearRect(0, 0, state.canvasW, state.canvasH);
    octx.save();
    octx.strokeStyle = '#f0e040';
    octx.lineWidth = 1;
    octx.setLineDash([4, 4]);
    const x = Math.min(state.dragStart.x, pos.x);
    const y = Math.min(state.dragStart.y, pos.y);
    const w = Math.abs(pos.x - state.dragStart.x);
    const h = Math.abs(pos.y - state.dragStart.y);
    octx.strokeRect(x, y, w, h);
    octx.restore();
  }
}

function onMouseUp(e) {
  if (!state.isDrawing) return;
  state.isDrawing = false;
  const tool = state.tool;

  if (tool === 'brush' || tool === 'eraser') {
    saveHistory();
    octx.clearRect(0, 0, state.canvasW, state.canvasH);
  } else if (tool === 'select' || tool === 'move') {
    state.isDragging = false;
    saveHistory();
  }
  octx.clearRect(0, 0, state.canvasW, state.canvasH);
  renderAll();
}

// ─── FLOOD FILL ───────────────────────────────────────────────────
function floodFill(x, y, fillColorHex) {
  const imageData = ctx.getImageData(0, 0, state.canvasW, state.canvasH);
  const data = imageData.data;
  const w = state.canvasW, h = state.canvasH;
  const idx = (y * w + x) * 4;
  const targetR = data[idx], targetG = data[idx+1], targetB = data[idx+2], targetA = data[idx+3];
  const fc = hexToRgb(fillColorHex);
  if (targetR === fc.r && targetG === fc.g && targetB === fc.b) return;

  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const ci = (cy * w + cx) * 4;
    if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
    if (data[ci] !== targetR || data[ci+1] !== targetG || data[ci+2] !== targetB || data[ci+3] !== targetA) continue;
    data[ci] = fc.r; data[ci+1] = fc.g; data[ci+2] = fc.b; data[ci+3] = 255;
    stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
  }
  ctx.putImageData(imageData, 0, 0);
}

// ─── ADJUSTMENTS ─────────────────────────────────────────────────
function buildCssFilter() {
  const b = document.getElementById('adjBrightness').value;
  const con = document.getElementById('adjContrast').value;
  const sat = document.getElementById('adjSaturate').value;
  const hue = document.getElementById('adjHue').value;
  const blur = document.getElementById('adjBlur').value;
  const sepia = document.getElementById('adjSepia').value;
  const invert = document.getElementById('adjInvert').value;
  const gs = document.getElementById('adjGrayscale').value;
  const bv = 1 + parseFloat(b) / 150;
  const cv = 1 + parseFloat(con) / 100;
  const sv = 1 + parseFloat(sat) / 100;
  return `brightness(${bv}) contrast(${cv}) saturate(${sv}) hue-rotate(${hue}deg) blur(${blur}px) sepia(${sepia/100}) invert(${invert/100}) grayscale(${gs/100})`;
}

function applyAdjustments() {
  const l = getLayerById(state.selectedLayerId);
  if (!l) return showToast('Pilih layer dulu!', 'error');
  l.cssFilter = buildCssFilter();
  renderAll(); saveHistory();
  showToast('Filter diterapkan!', 'success');
}

function resetAdjustments() {
  ['adjBrightness','adjContrast','adjSaturate','adjHue','adjBlur','adjSepia','adjInvert','adjGrayscale'].forEach(id => {
    document.getElementById(id).value = id === 'adjBrightness' ? 0 : id === 'adjContrast' ? 0 : 0;
  });
  updateAdjLabels();
  const l = getLayerById(state.selectedLayerId);
  if (l) { l.cssFilter = ''; renderAll(); }
}

function updateAdjLabels() {
  document.getElementById('adjBrightnessVal').textContent = document.getElementById('adjBrightness').value;
  document.getElementById('adjContrastVal').textContent = document.getElementById('adjContrast').value;
  document.getElementById('adjSaturateVal').textContent = document.getElementById('adjSaturate').value;
  document.getElementById('adjHueVal').textContent = document.getElementById('adjHue').value + '°';
  document.getElementById('adjBlurVal').textContent = document.getElementById('adjBlur').value + 'px';
  document.getElementById('adjSepiaVal').textContent = document.getElementById('adjSepia').value + '%';
  document.getElementById('adjInvertVal').textContent = document.getElementById('adjInvert').value + '%';
  document.getElementById('adjGrayscaleVal').textContent = document.getElementById('adjGrayscale').value + '%';
}

// ─── HELPERS ─────────────────────────────────────────────────────
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return {r,g,b};
}
function hexToRgba(hex, alpha) {
  const {r,g,b} = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(() => { t.className = 'toast'; }, 2500);
}

// ─── EVENT BINDINGS ───────────────────────────────────────────────
// Tools
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.tool = btn.dataset.tool;
    if (state.tool === 'brush' || state.tool === 'eraser') {
      paintLayerId = null; // will auto-create on draw
    }
    wrapper.style.cursor = state.tool === 'brush' || state.tool === 'eraser' ? 'crosshair' :
      state.tool === 'text' ? 'text' : state.tool === 'fill' ? 'cell' : 'default';
  });
});

// Colors
document.getElementById('fgColorDisplay').addEventListener('click', () => {
  const p = document.getElementById('fgColorPicker');
  p.style.position = 'fixed';
  p.click();
});
document.getElementById('fgColorPicker').addEventListener('input', e => {
  state.fgColor = e.target.value;
  document.getElementById('fgColorDisplay').style.background = state.fgColor;
});
document.getElementById('bgColorDisplay').addEventListener('click', () => {
  document.getElementById('bgColorPicker').click();
});
document.getElementById('bgColorPicker').addEventListener('input', e => {
  state.bgColor = e.target.value;
  document.getElementById('bgColorDisplay').style.background = state.bgColor;
});

// Brush
document.getElementById('brushSize').addEventListener('input', e => {
  state.brushSize = +e.target.value;
  document.getElementById('brushSizeVal').textContent = e.target.value;
});
document.getElementById('brushOpacity').addEventListener('input', e => {
  state.brushOpacity = +e.target.value;
  document.getElementById('brushOpacityVal').textContent = e.target.value + '%';
});

// Zoom
document.getElementById('btnZoomIn').addEventListener('click', () => setZoom(state.zoom * 1.2));
document.getElementById('btnZoomOut').addEventListener('click', () => setZoom(state.zoom / 1.2));
document.getElementById('btnZoomFit').addEventListener('click', fitZoom);
viewport.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 0.9)); }
}, { passive: false });

// Canvas size
document.getElementById('btnApplySize').addEventListener('click', () => {
  const w = +document.getElementById('canvasW').value;
  const h = +document.getElementById('canvasH').value;
  if (w < 10 || h < 10) return;
  if (!confirm(`Resize canvas ke ${w}×${h}? Konten akan diratakan.`)) return;
  resizeCanvas(w, h);
  updateDlFinalSize();
});
document.getElementById('presetSize').addEventListener('change', e => {
  if (!e.target.value) return;
  const [w, h] = e.target.value.split('x').map(Number);
  document.getElementById('canvasW').value = w;
  document.getElementById('canvasH').value = h;
  e.target.value = '';
});

// Layers
document.getElementById('btnAddPhoto').addEventListener('click', () => document.getElementById('fileInput').click());
document.getElementById('fileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => { addImageLayer(img, file.name.replace(/\.[^.]+$/, '')); saveHistory(); renderLayers(); };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

document.getElementById('btnAddText').addEventListener('click', () => {
  document.querySelector('.ptab[data-tab="text"]').click();
});
document.getElementById('btnAddShape').addEventListener('click', () => {
  document.querySelector('.ptab[data-tab="shape"]').click();
});
document.getElementById('btnDeleteLayer').addEventListener('click', deleteSelectedLayer);

// Layer props
document.getElementById('layerOpacity').addEventListener('input', e => {
  document.getElementById('layerOpacityVal').textContent = e.target.value + '%';
  const l = getLayerById(state.selectedLayerId);
  if (l) { l.opacity = +e.target.value; renderAll(); }
});
document.getElementById('layerBlend').addEventListener('change', e => {
  const l = getLayerById(state.selectedLayerId);
  if (l) { l.blendMode = e.target.value; renderAll(); }
});
document.getElementById('layerRotate').addEventListener('input', e => {
  document.getElementById('layerRotateVal').textContent = e.target.value + '°';
  const l = getLayerById(state.selectedLayerId);
  if (l) { l.rotate = +e.target.value; renderAll(); }
});
document.getElementById('btnApplyProps').addEventListener('click', () => {
  const l = getLayerById(state.selectedLayerId);
  if (!l) return;
  l.x = +document.getElementById('layerX').value;
  l.y = +document.getElementById('layerY').value;
  const nw = +document.getElementById('layerW').value;
  const nh = +document.getElementById('layerH').value;
  if (nw > 0) l.w = nw;
  if (nh > 0) l.h = nh;
  renderAll(); saveHistory(); showToast('Properties diterapkan!', 'success');
});

// Text insert
document.getElementById('btnInsertText').addEventListener('click', () => {
  const content = document.getElementById('textContent').value.trim();
  if (!content) return showToast('Tulis teks dulu!', 'error');
  addTextLayer({
    content,
    fontFamily: document.getElementById('textFont').value,
    fontSize: +document.getElementById('textSize').value,
    fontWeight: document.getElementById('textWeight').value,
    fontStyle: document.getElementById('textStyle').value,
    textAlign: state.textAlign,
    color: document.getElementById('textColor').value,
    lineHeight: +document.getElementById('textLineH').value,
    strokeColor: document.getElementById('textStrokeColor').value,
    strokeSize: +document.getElementById('textStrokeSize').value,
    shadowColor: document.getElementById('textShadowColor').value,
    shadowBlur: +document.getElementById('textShadowBlur').value,
    shadowX: +document.getElementById('textShadowX').value,
    shadowY: +document.getElementById('textShadowY').value,
    bgColor: document.getElementById('textBgColor').value,
    bgOpacity: +document.getElementById('textBgOpacity').value,
    bgPad: +document.getElementById('textBgPad').value,
  });
  showToast('Teks ditambahkan!', 'success');
});

// Text align
document.querySelectorAll('[data-align]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-align]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.textAlign = btn.dataset.align;
  });
});

// Shape insert
document.querySelectorAll('.shape-pick').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.shape-pick').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.selectedShape = btn.dataset.shape;
  });
});
document.getElementById('btnInsertShape').addEventListener('click', () => {
  if (!state.selectedShape) return showToast('Pilih shape dulu!', 'error');
  addShapeLayer({
    shape: state.selectedShape,
    fill: document.getElementById('shapeFill').value,
    stroke: document.getElementById('shapeStroke').value,
    strokeW: +document.getElementById('shapeStrokeW').value,
    shapeOpacity: +document.getElementById('shapeOpacity').value,
    w: +document.getElementById('shapeW').value,
    h: +document.getElementById('shapeH').value,
  });
  showToast('Shape ditambahkan!', 'success');
});

// Adjustments
['adjBrightness','adjContrast','adjSaturate','adjHue','adjBlur','adjSepia','adjInvert','adjGrayscale'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateAdjLabels);
});
document.getElementById('btnApplyAdj').addEventListener('click', applyAdjustments);
document.getElementById('btnResetAdj').addEventListener('click', resetAdjustments);

// Quick filters
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const l = getLayerById(state.selectedLayerId);
    if (!l) return showToast('Pilih layer dulu!', 'error');
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    l.cssFilter = btn.dataset.filter === 'none' ? '' : btn.dataset.filter;
    renderAll(); saveHistory();
    showToast('Filter diterapkan!', 'success');
  });
});

// Undo / Redo
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnRedo').addEventListener('click', redo);
document.getElementById('btnClear').addEventListener('click', () => {
  if (!confirm('Bersihkan semua layer?')) return;
  state.layers = []; layerCounter = 0; state.selectedLayerId = null; paintLayerId = null;
  addLayerBackground('#ffffff');
  renderAll(); renderLayers(); saveHistory();
  showToast('Canvas dibersihkan');
});

// Keyboard shortcuts
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z') { e.preventDefault(); undo(); }
    if (k === 'y') { e.preventDefault(); redo(); }
    if (k === 's') { e.preventDefault(); triggerDownload(); }
    if (k === '+' || k === '=') { e.preventDefault(); setZoom(state.zoom * 1.2); }
    if (k === '-') { e.preventDefault(); setZoom(state.zoom / 1.2); }
    if (k === '0') { e.preventDefault(); fitZoom(); }
    return;
  }
  const toolMap = { v: 'select', m: 'move', t: 'text', b: 'brush', e: 'eraser', f: 'fill', c: 'crop', s: 'shape' };
  if (toolMap[k]) {
    const btn = document.querySelector(`[data-tool="${toolMap[k]}"]`);
    if (btn) btn.click();
  }
  if (k === 'delete' || k === 'backspace') deleteSelectedLayer();
  if (k === 'escape') { state.isDrawing = false; state.isDragging = false; octx.clearRect(0,0,state.canvasW,state.canvasH); }
});

// Tabs
document.querySelectorAll('.ptab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// Download Modal
function triggerDownload() {
  updateDlFinalSize();
  document.getElementById('dlModal').style.display = 'flex';
}
document.getElementById('btnDownload').addEventListener('click', triggerDownload);
document.getElementById('dlCancel').addEventListener('click', () => document.getElementById('dlModal').style.display = 'none');

function updateDlFinalSize() {
  const scale = +document.getElementById('dlScale').value || 1;
  document.getElementById('dlFinalSize').textContent = `${Math.round(state.canvasW*scale)}×${Math.round(state.canvasH*scale)}`;
}
document.getElementById('dlScale').addEventListener('input', updateDlFinalSize);

document.querySelectorAll('.quality-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.selectedQuality = btn.dataset.q;
  });
});

document.getElementById('dlConfirm').addEventListener('click', () => {
  const format = document.getElementById('dlFormat').value;
  const qmap = { low: 0.3, mid: 0.7, high: 0.9, max: 1.0 };
  const quality = qmap[state.selectedQuality] || 0.85;
  const scale = +document.getElementById('dlScale').value || 1;
  const filename = document.getElementById('dlFilename').value || 'pixelforge-export';
  document.getElementById('dlModal').style.display = 'none';
  downloadImage(format, quality, scale, filename);
});

// New Canvas Modal
document.getElementById('btnNewCanvas').addEventListener('click', () => {
  document.getElementById('canvasModal').style.display = 'flex';
});
document.getElementById('newCanvasCancel').addEventListener('click', () => document.getElementById('canvasModal').style.display = 'none');
document.getElementById('newPreset').addEventListener('change', e => {
  if (!e.target.value) return;
  const [w, h] = e.target.value.split(',').map(Number);
  document.getElementById('newW').value = w;
  document.getElementById('newH').value = h;
  e.target.value = '';
});
document.getElementById('newCanvasConfirm').addEventListener('click', () => {
  const w = +document.getElementById('newW').value;
  const h = +document.getElementById('newH').value;
  const bg = document.getElementById('newBg').value;
  if (!confirm(`Buat canvas baru ${w}×${h}? Semua layer akan hilang.`)) return;
  document.getElementById('canvasModal').style.display = 'none';
  state.layers = []; layerCounter = 0; state.selectedLayerId = null; paintLayerId = null;
  state.canvasW = w; state.canvasH = h;
  mainCanvas.width = w; mainCanvas.height = h;
  overlayCanvas.width = w; overlayCanvas.height = h;
  wrapper.style.width = w + 'px'; wrapper.style.height = h + 'px';
  document.getElementById('canvasW').value = w;
  document.getElementById('canvasH').value = h;
  addLayerBackground(bg);
  renderAll(); renderLayers(); saveHistory(); fitZoom();
  showToast(`Canvas ${w}×${h} dibuat!`, 'success');
  updateDlFinalSize();
});

// Drag-drop file
document.body.addEventListener('dragover', e => e.preventDefault());
document.body.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => { addImageLayer(img, file.name.replace(/\.[^.]+$/, '')); saveHistory(); renderLayers(); };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// Click on canvas to add text (text tool)
wrapper.addEventListener('click', e => {
  if (state.tool !== 'text') return;
  const pos = getCanvasPos(e);
  const content = document.getElementById('textContent').value.trim() || 'Teks Baru';
  addTextLayer({
    content,
    x: Math.round(pos.x), y: Math.round(pos.y),
    fontFamily: document.getElementById('textFont').value,
    fontSize: +document.getElementById('textSize').value,
    fontWeight: document.getElementById('textWeight').value,
    fontStyle: document.getElementById('textStyle').value,
    textAlign: state.textAlign,
    color: document.getElementById('textColor').value,
    lineHeight: +document.getElementById('textLineH').value,
    strokeColor: document.getElementById('textStrokeColor').value,
    strokeSize: +document.getElementById('textStrokeSize').value,
    shadowColor: document.getElementById('textShadowColor').value,
    shadowBlur: +document.getElementById('textShadowBlur').value,
    shadowX: +document.getElementById('textShadowX').value,
    shadowY: +document.getElementById('textShadowY').value,
    bgColor: document.getElementById('textBgColor').value,
    bgOpacity: +document.getElementById('textBgOpacity').value,
    bgPad: +document.getElementById('textBgPad').value,
  });
});

// Backdrop click to close modals
document.getElementById('dlModal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; });
document.getElementById('canvasModal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; });

// Paste image
window.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => { addImageLayer(img, 'Pasted'); saveHistory(); renderLayers(); showToast('Gambar ditempel!', 'success'); };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(blob);
      break;
    }
  }
});

// ─── LAUNCH ───────────────────────────────────────────────────────
window.addEventListener('load', () => {
  init();
  setTimeout(fitZoom, 100);
});
