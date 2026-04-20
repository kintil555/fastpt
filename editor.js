/* ═══════════════════════════════════════════════════════════════
   PixelForge v3 — Editor Engine
   KEY FIXES:
   - Undo/Redo saves LAYER STATE (not flat bitmap) → no merge bug
   - Layer images stored as HTMLImageElement, serialised as dataURL for history
   - Proper transform handles (drag-to-resize working)
   - Live inspector: click text/shape layer → fields auto-fill
   - Mobile-friendly touch handling
   ═══════════════════════════════════════════════════════════════ */
'use strict';

// ─── CANVAS SETUP ────────────────────────────────────────────────
const MC  = document.getElementById('mainCanvas');
const OC  = document.getElementById('overlayCanvas');
const ctx = MC.getContext('2d');
const oct = OC.getContext('2d');
const VP  = document.getElementById('viewport');
const CW  = document.getElementById('canvasWrapper');

// ─── STATE ───────────────────────────────────────────────────────
let S = {
  w: 800, h: 600, zoom: 1,
  tool: 'select',
  fg: '#ffffff', bg: '#000000',
  brushSz: 12, brushOp: 100,
  textAlign: 'left',
  selShape: 'rect',
  dlQuality: .7,
  layers: [],          // array of layer objects (top = last index)
  selId: null,
  history: [],         // each entry = serialised layer snapshot array
  histIdx: -1,
  ia: null,            // active interaction {type,handle,startPos,startLayer}
  painting: false,
  paintId: null,
};
let LC = 0; // layer id counter

// ─── LAYER SCHEMA ────────────────────────────────────────────────
// fill:  {id,type:'fill',  name,visible,locked,opacity,blend, x,y,w,h,rot, color}
// image: {id,type:'image', name,visible,locked,opacity,blend, x,y,w,h,rot, img(HTMLImageElement), srcUrl, cssFilter}
// text:  {id,type:'text',  name,visible,locked,opacity,blend, x,y,w,h,rot, ...textProps}
// shape: {id,type:'shape', name,visible,locked,opacity,blend, x,y,w,h,rot, ...shapeProps}
// paint: {id,type:'paint', name,visible,locked,opacity,blend, x,y,w,h,rot, pc(offscreen canvas), pcData(for history)}

function mkId() { return ++LC; }

// ─── INIT ─────────────────────────────────────────────────────────
function init() {
  setCanvasSize(S.w, S.h, false);
  addFill('#ffffff');
  renderAll();
  refreshLayerList();
  pushHistory();
  setTimeout(fitZoom, 50);
  updateDlSize();
}

// ─── CANVAS SIZE ─────────────────────────────────────────────────
function setCanvasSize(w, h, preserveContent = true) {
  let snapUrl = null;
  if (preserveContent && S.layers.length) snapUrl = flatExport('png', 1);

  S.w = w; S.h = h;
  MC.width = w; MC.height = h;
  OC.width = w; OC.height = h;
  CW.style.width  = w + 'px';
  CW.style.height = h + 'px';
  document.getElementById('cW').value = w;
  document.getElementById('cH').value = h;

  if (preserveContent && snapUrl) {
    S.layers = []; S.selId = null; S.paintId = null;
    const img = new Image();
    img.onload = () => {
      addImage(img, 'Canvas', 0, 0, w, h);
      renderAll(); refreshLayerList(); pushHistory();
    };
    img.src = snapUrl;
  }
}

// ─── ADD LAYERS ──────────────────────────────────────────────────
function addFill(color) {
  const id = mkId();
  S.layers.push({ id, type:'fill', name:'Background', visible:true, locked:false,
    opacity:100, blend:'source-over', x:0, y:0, w:S.w, h:S.h, rot:0, color });
  S.selId = id;
}

function addImage(img, name='Photo', fx, fy, fw, fh) {
  const id = mkId();
  let iw = fw !== undefined ? fw : img.naturalWidth || img.width;
  let ih = fh !== undefined ? fh : img.naturalHeight || img.height;
  // fit to canvas
  const scale = Math.min(1, S.w / iw, S.h / ih);
  iw = Math.round(iw * scale); ih = Math.round(ih * scale);
  const x = fx !== undefined ? fx : Math.round((S.w - iw) / 2);
  const y = fy !== undefined ? fy : Math.round((S.h - ih) / 2);
  S.layers.push({ id, type:'image', name, visible:true, locked:false,
    opacity:100, blend:'source-over', x, y, w:iw, h:ih, rot:0, img });
  S.selId = id;
  renderAll(); refreshLayerList(); populateInspector();
}

function addTextLayer(props) {
  const id = mkId();
  const measured = measureText(props);
  S.layers.push({ id, type:'text', name:'Text: '+props.content.slice(0,14),
    visible:true, locked:false, opacity:100, blend:'source-over',
    x: props.x||60, y: props.y||60, w: measured.w, h: measured.h, rot:0, ...props });
  S.selId = id;
  renderAll(); refreshLayerList(); populateInspector();
}

function addShapeLayer(props) {
  const id = mkId();
  const x = Math.round((S.w - props.w) / 2);
  const y = Math.round((S.h - props.h) / 2);
  S.layers.push({ id, type:'shape', name:'Shape: '+props.shape, visible:true, locked:false,
    opacity:100, blend:'source-over', x, y, rot:0, ...props });
  S.selId = id;
  renderAll(); refreshLayerList(); populateInspector();
}

function addPaint() {
  const id = mkId();
  const pc = document.createElement('canvas');
  pc.width = S.w; pc.height = S.h;
  S.layers.push({ id, type:'paint', name:'Paint', visible:true, locked:false,
    opacity:100, blend:'source-over', x:0, y:0, w:S.w, h:S.h, rot:0, pc });
  S.selId = id; S.paintId = id;
  refreshLayerList();
  return id;
}

function getLayer(id) { return S.layers.find(l => l.id === id); }
function selLayer()   { return getLayer(S.selId); }

function delSelected() {
  if (!S.selId) return;
  const i = S.layers.findIndex(l => l.id === S.selId);
  if (i < 0) return;
  S.layers.splice(i, 1);
  S.selId = S.layers.length ? S.layers[S.layers.length - 1].id : null;
  renderAll(); refreshLayerList(); populateInspector(); pushHistory();
}

// ─── RENDER ──────────────────────────────────────────────────────
function renderAll() {
  ctx.clearRect(0, 0, S.w, S.h);
  for (const l of S.layers) {
    if (!l.visible) continue;
    ctx.save();
    ctx.globalAlpha = l.opacity / 100;
    ctx.globalCompositeOperation = l.blend || 'source-over';
    if (l.rot) {
      ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
      ctx.rotate(l.rot * Math.PI / 180);
      ctx.translate(-(l.x + l.w / 2), -(l.y + l.h / 2));
    }
    drawLayer(l);
    ctx.restore();
  }
  drawOverlay();
}

function drawLayer(l) {
  switch (l.type) {
    case 'fill':
      ctx.fillStyle = l.color;
      ctx.fillRect(l.x, l.y, l.w, l.h);
      break;
    case 'image':
      if (l.cssFilter) ctx.filter = l.cssFilter;
      ctx.drawImage(l.img, l.x, l.y, l.w, l.h);
      ctx.filter = 'none';
      break;
    case 'text':
      drawText(l);
      break;
    case 'shape':
      drawShape(l);
      break;
    case 'paint':
      ctx.drawImage(l.pc, 0, 0);
      break;
  }
}

function drawText(l) {
  ctx.save();
  const lines = (l.content || '').split('\n');
  const fs = l.fontSize || 48;
  ctx.font = `${l.fontStyle||'normal'} ${l.fontWeight||700} ${fs}px ${l.fontFamily||'Space Grotesk,sans-serif'}`;
  ctx.textBaseline = 'top';
  const lh = fs * (l.lineH || 1.2);
  const mw = lines.reduce((m, ln) => Math.max(m, ctx.measureText(ln).width), 0);
  // bg
  if ((l.bgAlpha || 0) > 0) {
    ctx.fillStyle = hexAlpha(l.bgColor || '#000', l.bgAlpha / 100);
    const p = l.bgPad || 8;
    ctx.fillRect(l.x - p, l.y - p, mw + p*2, lines.length * lh + p*2);
  }
  if (l.shadowBlur || l.shadowX || l.shadowY) {
    ctx.shadowColor   = l.shadowColor || '#000';
    ctx.shadowBlur    = l.shadowBlur || 0;
    ctx.shadowOffsetX = l.shadowX || 0;
    ctx.shadowOffsetY = l.shadowY || 0;
  }
  lines.forEach((line, i) => {
    const lx = l.textAlign === 'center' ? l.x + l.w/2 : l.textAlign === 'right' ? l.x + l.w : l.x;
    const ly = l.y + i * lh;
    ctx.textAlign = l.textAlign || 'left';
    if ((l.strokeW || 0) > 0) {
      ctx.strokeStyle = l.strokeColor || '#000';
      ctx.lineWidth = l.strokeW; ctx.lineJoin = 'round';
      ctx.strokeText(line, lx, ly);
    }
    ctx.fillStyle = l.color || '#fff';
    ctx.fillText(line, lx, ly);
  });
  ctx.restore();
}

function measureText(props) {
  const c = document.createElement('canvas').getContext('2d');
  const fs = props.fontSize || 48;
  c.font = `${props.fontStyle||'normal'} ${props.fontWeight||700} ${fs}px ${props.fontFamily||'Space Grotesk,sans-serif'}`;
  const lines = (props.content || '').split('\n');
  const w = Math.ceil(lines.reduce((m, l) => Math.max(m, c.measureText(l).width), 0)) || 200;
  const h = Math.ceil(lines.length * fs * (props.lineH || 1.2)) || 60;
  return { w, h };
}

function drawShape(l) {
  ctx.save();
  ctx.fillStyle   = l.fill || 'transparent';
  ctx.strokeStyle = l.stroke || '#000';
  ctx.lineWidth   = l.strokeW || 0;
  const {x,y,w,h} = l;
  ctx.beginPath();
  switch (l.shape) {
    case 'rect':         ctx.rect(x,y,w,h); break;
    case 'rounded-rect': ctx.roundRect(x,y,w,h,Math.min(w,h)*.1); break;
    case 'circle':       ctx.arc(x+w/2,y+h/2,Math.min(w,h)/2,0,Math.PI*2); break;
    case 'ellipse':      ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2); break;
    case 'triangle':     ctx.moveTo(x+w/2,y); ctx.lineTo(x+w,y+h); ctx.lineTo(x,y+h); ctx.closePath(); break;
    case 'star':         drawStar(x+w/2,y+h/2,Math.min(w,h)/2,Math.min(w,h)/4); break;
    case 'line':         ctx.moveTo(x,y+h/2); ctx.lineTo(x+w,y+h/2); break;
    case 'arrow':        drawArrow(x,y+h/2,x+w,y+h/2,h/3); break;
  }
  if (l.fill && l.fill !== 'transparent') ctx.fill();
  if (l.strokeW > 0) ctx.stroke();
  ctx.restore();
}
function drawStar(cx,cy,or,ir,pts=5) {
  for (let i=0;i<pts*2;i++) {
    const r=i%2===0?or:ir, a=(i*Math.PI/pts)-Math.PI/2;
    i===0?ctx.moveTo(cx+r*Math.cos(a),cy+r*Math.sin(a)):ctx.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a));
  }
  ctx.closePath();
}
function drawArrow(x1,y1,x2,y2,hw) {
  const a=Math.atan2(y2-y1,x2-x1), hl=hw*1.5;
  ctx.moveTo(x1,y1); ctx.lineTo(x2-hl*Math.cos(a),y2-hl*Math.sin(a)); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2,y2);
  ctx.lineTo(x2-hl*Math.cos(a-.4),y2-hl*Math.sin(a-.4));
  ctx.lineTo(x2-hl*Math.cos(a+.4),y2-hl*Math.sin(a+.4));
  ctx.closePath(); ctx.fillStyle=ctx.strokeStyle; ctx.fill();
}

// ─── OVERLAY / HANDLES ───────────────────────────────────────────
const HW = 6; // half-width of handle square
// 8 handle positions: [id, xF, yF, cursor]
const HANDLES = [
  ['nw',0,0,'nwse-resize'], ['n',.5,0,'ns-resize'], ['ne',1,0,'nesw-resize'],
  ['e',1,.5,'ew-resize'],
  ['se',1,1,'nwse-resize'], ['s',.5,1,'ns-resize'], ['sw',0,1,'nesw-resize'],
  ['w',0,.5,'ew-resize'],
];

function drawOverlay() {
  oct.clearRect(0, 0, S.w, S.h);
  const l = selLayer();
  if (!l || l.type === 'fill') return;
  const {x,y,w,h} = l;

  // selection box
  oct.save();
  oct.strokeStyle = '#f0e040'; oct.lineWidth = 1.5; oct.setLineDash([5,4]);
  oct.strokeRect(x - 1, y - 1, (w||0) + 2, (h||0) + 2);
  oct.restore();

  // handles
  for (const [,xF,yF] of HANDLES) {
    const hx = x + (w||0)*xF, hy = y + (h||0)*yF;
    oct.fillStyle = '#111';
    oct.fillRect(hx-HW, hy-HW, HW*2, HW*2);
    oct.strokeStyle = '#f0e040'; oct.lineWidth = 1.5; oct.setLineDash([]);
    oct.strokeRect(hx-HW, hy-HW, HW*2, HW*2);
  }
}

function hitHandle(pos, l) {
  if (!l || l.type === 'fill') return null;
  const {x,y,w,h} = l;
  for (const [id,xF,yF,cur] of HANDLES) {
    const hx = x+(w||0)*xF, hy = y+(h||0)*yF;
    if (Math.abs(pos.x-hx) <= HW+3 && Math.abs(pos.y-hy) <= HW+3) return {id,cur};
  }
  return null;
}

function hitLayer(pos) {
  for (let i = S.layers.length-1; i >= 0; i--) {
    const l = S.layers[i];
    if (!l.visible || l.type === 'fill') continue;
    if (pos.x >= l.x && pos.x <= l.x+(l.w||0) && pos.y >= l.y && pos.y <= l.y+(l.h||0)) return l;
  }
  // fall back to fill/background
  for (let i = S.layers.length-1; i >= 0; i--) {
    const l = S.layers[i];
    if (!l.visible) continue;
    if (pos.x >= l.x && pos.x <= l.x+(l.w||0) && pos.y >= l.y && pos.y <= l.y+(l.h||0)) return l;
  }
  return null;
}

// ─── INPUT ───────────────────────────────────────────────────────
OC.style.pointerEvents = 'auto';

function evPos(e) {
  const r = CW.getBoundingClientRect();
  const cl = e.touches ? e.touches[0] : e;
  return { x: (cl.clientX - r.left) / S.zoom, y: (cl.clientY - r.top) / S.zoom };
}

CW.addEventListener('mousedown',  onDown);
CW.addEventListener('touchstart', e => { e.preventDefault(); onDown(e); }, {passive:false});
window.addEventListener('mousemove',  onMove);
window.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e); }, {passive:false});
window.addEventListener('mouseup',    onUp);
window.addEventListener('touchend',   onUp);

function onDown(e) {
  if (e.button === 2) return;
  e.preventDefault();
  const pos  = evPos(e);
  const tool = S.tool;

  if (tool === 'brush' || tool === 'eraser') {
    S.painting = true;
    let pid = S.paintId;
    if (!pid || !getLayer(pid)) { pid = addPaint(); }
    const pc2 = getLayer(pid).pc.getContext('2d');
    pc2.beginPath(); pc2.moveTo(pos.x, pos.y);
    return;
  }

  if (tool === 'fill') {
    floodFill(Math.round(pos.x), Math.round(pos.y), S.fg);
    pushHistory(); return;
  }

  if (tool === 'eyedropper') {
    const px = ctx.getImageData(Math.round(pos.x), Math.round(pos.y), 1, 1).data;
    S.fg = rgbToHex(px[0], px[1], px[2]);
    updateColorSwatches();
    showToast('Color picked: ' + S.fg, 'ok');
    return;
  }

  if (tool === 'text') {
    // clicking on existing text layer → select it; else place new
    const hit = hitLayer(pos);
    if (hit && hit.type === 'text') {
      S.selId = hit.id;
      renderAll(); refreshLayerList(); populateInspector();
      setTool('select');
    } else {
      const content = document.getElementById('tContent').value.trim() || 'Text';
      addTextLayer({ ...readTextFields(), x: Math.round(pos.x), y: Math.round(pos.y), content });
      pushHistory();
    }
    return;
  }

  if (tool === 'select') {
    const sel = selLayer();
    const hnd = hitHandle(pos, sel);
    if (hnd) {
      S.ia = { type:'resize', handle:hnd.id, startPos:{...pos},
        startL:{x:sel.x, y:sel.y, w:sel.w, h:sel.h} };
      return;
    }
    const hit = hitLayer(pos);
    if (hit) {
      if (hit.id !== S.selId) {
        S.selId = hit.id;
        renderAll(); refreshLayerList(); populateInspector();
      }
      if (hit.type !== 'fill') {
        S.ia = { type:'move', startPos:{...pos}, startL:{x:hit.x, y:hit.y} };
      }
      return;
    }
    S.selId = null;
    renderAll(); refreshLayerList(); populateInspector();
  }
}

function onMove(e) {
  const pos = evPos(e);
  updateCursor(pos);

  if (S.painting) {
    const l = getLayer(S.paintId);
    if (!l) return;
    const p2 = l.pc.getContext('2d');
    p2.globalCompositeOperation = S.tool === 'eraser' ? 'destination-out' : 'source-over';
    p2.globalAlpha = S.brushOp / 100;
    p2.strokeStyle = S.fg; p2.lineWidth = S.brushSz;
    p2.lineCap = 'round'; p2.lineJoin = 'round';
    p2.lineTo(pos.x, pos.y); p2.stroke();
    p2.beginPath(); p2.moveTo(pos.x, pos.y);
    renderAll(); return;
  }

  if (!S.ia) return;
  const {type,handle,startPos,startL} = S.ia;
  const dx = pos.x - startPos.x, dy = pos.y - startPos.y;
  const l = selLayer();
  if (!l || l.locked || l.type === 'fill') return;

  if (type === 'move') {
    l.x = Math.round(startL.x + dx);
    l.y = Math.round(startL.y + dy);
  } else if (type === 'resize') {
    let {x,y,w,h} = startL;
    if (handle.includes('e')) w = Math.max(10, w + dx);
    if (handle.includes('s')) h = Math.max(10, h + dy);
    if (handle.includes('w')) { const nw=Math.max(10,w-dx); x+=w-nw; w=nw; }
    if (handle.includes('n')) { const nh=Math.max(10,h-dy); y+=h-nh; h=nh; }
    l.x=Math.round(x); l.y=Math.round(y); l.w=Math.round(w); l.h=Math.round(h);
  }
  renderAll();
  syncPropsFields(l);
}

function onUp() {
  if (S.painting) { S.painting = false; pushHistory(); }
  if (S.ia) { S.ia = null; pushHistory(); refreshLayerList(); }
}

function updateCursor(pos) {
  const sel = selLayer();
  const hnd = hitHandle(pos, sel);
  if (hnd) { CW.style.cursor = hnd.cur; return; }
  const map = { brush:'crosshair', eraser:'crosshair', fill:'cell', text:'text', eyedropper:'crosshair' };
  if (map[S.tool]) { CW.style.cursor = map[S.tool]; return; }
  CW.style.cursor = hitLayer(pos) ? 'grab' : 'default';
}

// ─── HISTORY (LAYER-BASED, no flatten) ───────────────────────────
// Each snapshot stores enough to reconstruct all layers.
// Images stored as dataURL, paint canvases as dataURL too.
function serialiseState() {
  return JSON.stringify({
    w: S.w, h: S.h, selId: S.selId,
    layers: S.layers.map(l => {
      const o = { ...l };
      if (l.type === 'image')  { o.img = null; o.srcUrl = l.img.src || l.srcUrl; }
      if (l.type === 'paint')  { o.pc = null; o.pcData = l.pc.toDataURL(); }
      return o;
    }),
  });
}

function deserialiseState(json) {
  const data = JSON.parse(json);
  S.w = data.w; S.h = data.h;
  MC.width = S.w; MC.height = S.h;
  OC.width = S.w; OC.height = S.h;
  CW.style.width = S.w+'px'; CW.style.height = S.h+'px';
  document.getElementById('cW').value = S.w;
  document.getElementById('cH').value = S.h;

  // restore layers — images are async, collect promises
  const promises = [];
  S.layers = data.layers.map(o => {
    if (o.type === 'image') {
      const img = new Image();
      const p = new Promise(res => { img.onload = res; img.onerror = res; });
      img.src = o.srcUrl || '';
      promises.push(p);
      return { ...o, img, srcUrl: o.srcUrl };
    }
    if (o.type === 'paint') {
      const pc = document.createElement('canvas');
      pc.width = S.w; pc.height = S.h;
      if (o.pcData) {
        const img2 = new Image();
        const p = new Promise(res => { img2.onload = () => { pc.getContext('2d').drawImage(img2, 0, 0); res(); }; img2.onerror = res; });
        img2.src = o.pcData;
        promises.push(p);
      }
      return { ...o, pc };
    }
    return { ...o };
  });
  S.selId = data.selId;
  Promise.all(promises).then(() => {
    renderAll(); refreshLayerList(); populateInspector();
  });
}

function pushHistory() {
  const snap = serialiseState();
  S.history = S.history.slice(0, S.histIdx + 1);
  S.history.push(snap);
  if (S.history.length > 40) S.history.shift();
  S.histIdx = S.history.length - 1;
}

function undo() {
  if (S.histIdx <= 0) return showToast('Nothing to undo', 'err');
  S.histIdx--;
  deserialiseState(S.history[S.histIdx]);
}
function redo() {
  if (S.histIdx >= S.history.length - 1) return showToast('Nothing to redo', 'err');
  S.histIdx++;
  deserialiseState(S.history[S.histIdx]);
}

// ─── ZOOM ────────────────────────────────────────────────────────
function setZoom(z) {
  S.zoom = Math.max(.05, Math.min(8, z));
  CW.style.transform = `scale(${S.zoom})`;
  CW.style.transformOrigin = 'top left';
  document.getElementById('zoomLabel').textContent = Math.round(S.zoom*100)+'%';
  updateDlSize();
}
function fitZoom() {
  const vw = VP.clientWidth - 40, vh = VP.clientHeight - 40;
  setZoom(Math.max(.05, Math.min(1, vw/S.w, vh/S.h)));
}

// ─── FLOOD FILL ───────────────────────────────────────────────────
function floodFill(x, y, fillHex) {
  const id = ctx.getImageData(0, 0, S.w, S.h);
  const d = id.data, w = S.w, h = S.h;
  const i = (y*w+x)*4;
  const tr=d[i],tg=d[i+1],tb=d[i+2],ta=d[i+3];
  const fc = hexToRgb(fillHex);
  if (tr===fc.r && tg===fc.g && tb===fc.b) return;
  const stack=[[x,y]];
  while (stack.length) {
    const [cx,cy]=stack.pop();
    if (cx<0||cx>=w||cy<0||cy>=h) continue;
    const ci=(cy*w+cx)*4;
    if (d[ci]!==tr||d[ci+1]!==tg||d[ci+2]!==tb||d[ci+3]!==ta) continue;
    d[ci]=fc.r; d[ci+1]=fc.g; d[ci+2]=fc.b; d[ci+3]=255;
    stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
  }
  ctx.putImageData(id,0,0);
}

// ─── EXPORT ──────────────────────────────────────────────────────
function flatExport(fmt='png', q=1) {
  const t = document.createElement('canvas');
  t.width=S.w; t.height=S.h;
  t.getContext('2d').drawImage(MC,0,0);
  return t.toDataURL('image/'+fmt, q);
}

function download(fmt, q, scale, name) {
  const sw=Math.round(S.w*scale), sh=Math.round(S.h*scale);
  const t=document.createElement('canvas');
  t.width=sw; t.height=sh;
  const tc=t.getContext('2d');
  tc.scale(scale,scale); tc.drawImage(MC,0,0);
  const a=document.createElement('a');
  a.href=t.toDataURL('image/'+(fmt==='jpeg'?'jpeg':fmt), q);
  a.download=name+'.'+(fmt==='jpeg'?'jpg':fmt); a.click();
  showToast('Downloaded! 🎉','ok');
}

// ─── INSPECTOR ───────────────────────────────────────────────────
function populateInspector() {
  const l = selLayer();
  // always update props tab
  if (l) {
    document.getElementById('pOpacity').value = l.opacity;
    document.getElementById('pOpacityVal').textContent = l.opacity+'%';
    document.getElementById('pBlend').value = l.blend||'source-over';
    syncPropsFields(l);
    document.getElementById('pRotate').value = l.rot||0;
    document.getElementById('pRotateVal').textContent=(l.rot||0)+'°';
  }

  if (!l || l.type === 'fill' || l.type === 'paint' || l.type === 'image') {
    document.getElementById('btnTextAction').textContent  = '+ Add Text';
    document.getElementById('btnShapeAction').textContent = '+ Add Shape';
    if (l?.type === 'image') switchTab('adjust');
    return;
  }
  if (l.type === 'text') {
    switchTab('text');
    document.getElementById('tContent').value       = l.content||'';
    document.getElementById('tFont').value          = l.fontFamily||'Space Grotesk,sans-serif';
    document.getElementById('tSize').value          = l.fontSize||48;
    document.getElementById('tWeight').value        = String(l.fontWeight||700);
    document.getElementById('tStyle').value         = l.fontStyle||'normal';
    document.getElementById('tColor').value         = l.color||'#ffffff';
    document.getElementById('tLineH').value         = l.lineH||1.2;
    document.getElementById('tStrokeColor').value   = l.strokeColor||'#000000';
    document.getElementById('tStrokeW').value       = l.strokeW||0;
    document.getElementById('tShadowColor').value   = l.shadowColor||'#000000';
    document.getElementById('tShadowBlur').value    = l.shadowBlur||0;
    document.getElementById('tShadowX').value       = l.shadowX||0;
    document.getElementById('tShadowY').value       = l.shadowY||3;
    document.getElementById('tBgColor').value       = l.bgColor||'#000000';
    document.getElementById('tBgAlpha').value       = l.bgAlpha||0;
    document.getElementById('tBgPad').value         = l.bgPad||8;
    document.querySelectorAll('[data-align]').forEach(b => b.classList.toggle('active', b.dataset.align === (l.textAlign||'left')));
    S.textAlign = l.textAlign||'left';
    document.getElementById('btnTextAction').textContent = '✓ Update Text';
    document.getElementById('btnShapeAction').textContent= '+ Add Shape';
  }
  if (l.type === 'shape') {
    switchTab('shape');
    document.querySelectorAll('.sgbtn').forEach(b => b.classList.toggle('active', b.dataset.shape===l.shape));
    S.selShape = l.shape;
    document.getElementById('sFill').value    = l.fill||'#ef4444';
    document.getElementById('sStroke').value  = l.stroke||'#000000';
    document.getElementById('sStrokeW').value = l.strokeW||0;
    document.getElementById('sW').value       = Math.round(l.w||200);
    document.getElementById('sH').value       = Math.round(l.h||150);
    document.getElementById('btnShapeAction').textContent = '✓ Update Shape';
    document.getElementById('btnTextAction').textContent  = '+ Add Text';
  }
}

function syncPropsFields(l) {
  document.getElementById('pX').value = Math.round(l.x);
  document.getElementById('pY').value = Math.round(l.y);
  document.getElementById('pW').value = Math.round(l.w||0);
  document.getElementById('pH').value = Math.round(l.h||0);
}

function switchTab(name) {
  document.querySelectorAll('.itab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  document.querySelectorAll('.ipanel').forEach(p=>p.classList.toggle('active', p.id==='tab-'+name));
}

// ─── READ FIELDS ─────────────────────────────────────────────────
function readTextFields() {
  return {
    content:     document.getElementById('tContent').value,
    fontFamily:  document.getElementById('tFont').value,
    fontSize:    +document.getElementById('tSize').value,
    fontWeight:  +document.getElementById('tWeight').value,
    fontStyle:   document.getElementById('tStyle').value,
    textAlign:   S.textAlign,
    color:       document.getElementById('tColor').value,
    lineH:       +document.getElementById('tLineH').value,
    strokeColor: document.getElementById('tStrokeColor').value,
    strokeW:     +document.getElementById('tStrokeW').value,
    shadowColor: document.getElementById('tShadowColor').value,
    shadowBlur:  +document.getElementById('tShadowBlur').value,
    shadowX:     +document.getElementById('tShadowX').value,
    shadowY:     +document.getElementById('tShadowY').value,
    bgColor:     document.getElementById('tBgColor').value,
    bgAlpha:     +document.getElementById('tBgAlpha').value,
    bgPad:       +document.getElementById('tBgPad').value,
  };
}

// live preview text
function liveText() {
  const l = selLayer();
  if (!l || l.type !== 'text') return;
  const f = readTextFields();
  Object.assign(l, f);
  const m = measureText(l);
  l.w = m.w; l.h = m.h;
  l.name = 'Text: '+l.content.slice(0,14);
  renderAll(); syncPropsFields(l); refreshLayerList();
}

// live preview shape
function liveShape() {
  const l = selLayer();
  if (!l || l.type !== 'shape') return;
  l.shape   = S.selShape;
  l.fill    = document.getElementById('sFill').value;
  l.stroke  = document.getElementById('sStroke').value;
  l.strokeW = +document.getElementById('sStrokeW').value;
  l.w       = +document.getElementById('sW').value;
  l.h       = +document.getElementById('sH').value;
  renderAll(); syncPropsFields(l);
}

// ─── LAYER LIST ──────────────────────────────────────────────────
function refreshLayerList() {
  const el = document.getElementById('layerList');
  el.innerHTML = '';
  [...S.layers].reverse().forEach(l => {
    const div = document.createElement('div');
    div.className = 'litem' + (l.id === S.selId ? ' active' : '');
    div.innerHTML = `
      <div class="lthumb">${l.type==='image'?'🖼':l.type==='text'?'T':l.type==='paint'?'🖌':l.type==='shape'?'▭':'🎨'}</div>
      <div class="linfo"><div class="lname">${l.name}</div><div class="ltype">${l.type}</div></div>
      <div class="lvis${l.visible?'':' hidden'}" data-id="${l.id}">${l.visible?'👁':'◌'}</div>`;
    div.querySelector('.lvis').addEventListener('click', ev => {
      ev.stopPropagation(); l.visible=!l.visible; renderAll(); refreshLayerList();
    });
    div.addEventListener('click', () => {
      S.selId = l.id; renderAll(); refreshLayerList(); populateInspector();
    });
    el.appendChild(div);
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────
function hexToRgb(h) { return {r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)}; }
function rgbToHex(r,g,b) { return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join(''); }
function hexAlpha(hex,a) { const {r,g,b}=hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function loadImg(src) { return new Promise(res=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>res(null); i.src=src; }); }

function showToast(msg, type='') {
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast show'+(type?' '+type:'');
  clearTimeout(t._to);
  t._to=setTimeout(()=>{t.className='toast';},2400);
}

function setTool(name) {
  S.tool = name;
  document.querySelectorAll('.tbtn[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===name));
  document.querySelectorAll('.mbtn[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===name));
}

function updateColorSwatches() {
  document.getElementById('fgSwatch').style.background = S.fg;
  document.getElementById('bgSwatch').style.background = S.bg;
  document.getElementById('fgPicker').value = S.fg;
  document.getElementById('bgPicker').value = S.bg;
}
function updateDlSize() {
  const sc = +document.getElementById('dlScale').value||1;
  document.getElementById('dlSize').textContent = `→ ${Math.round(S.w*sc)}×${Math.round(S.h*sc)}`;
}

function loadFile() {
  const fi=document.getElementById('fileInput');
  fi.click();
  fi.onchange=e=>{
    const f=e.target.files[0]; if(!f)return;
    const r=new FileReader();
    r.onload=async ev=>{
      const img=await loadImg(ev.target.result);
      if(img) { addImage(img,f.name.replace(/\.[^.]+$/,'')); pushHistory(); }
    };
    r.readAsDataURL(f); fi.value='';
  };
}

// ═══════════════════════════════════════════════════════════════
//  WIRING
// ═══════════════════════════════════════════════════════════════

// Tools
document.querySelectorAll('.tbtn[data-tool]').forEach(b=>{
  b.addEventListener('click',()=>{ setTool(b.dataset.tool); if(b.dataset.tool==='brush'||b.dataset.tool==='eraser') S.paintId=null; });
});
document.querySelectorAll('.mbtn[data-tool]').forEach(b=>{
  b.addEventListener('click',()=>{ setTool(b.dataset.tool); if(b.dataset.tool==='brush'||b.dataset.tool==='eraser') S.paintId=null; });
});

// Colors
document.getElementById('fgSwatch').addEventListener('click',()=>document.getElementById('fgPicker').click());
document.getElementById('bgSwatch').addEventListener('click',()=>document.getElementById('bgPicker').click());
document.getElementById('fgPicker').addEventListener('input',e=>{ S.fg=e.target.value; document.getElementById('fgSwatch').style.background=S.fg; });
document.getElementById('bgPicker').addEventListener('input',e=>{ S.bg=e.target.value; document.getElementById('bgSwatch').style.background=S.bg; });
document.getElementById('btnSwapColors').addEventListener('click',()=>{ [S.fg,S.bg]=[S.bg,S.fg]; updateColorSwatches(); });

// Brush
document.getElementById('brushSize').addEventListener('input',e=>{ S.brushSz=+e.target.value; document.getElementById('brushSizeVal').textContent=e.target.value; });
document.getElementById('brushOpacity').addEventListener('input',e=>{ S.brushOp=+e.target.value; document.getElementById('brushOpacityVal').textContent=e.target.value; });

// Zoom
document.getElementById('btnZoomIn').addEventListener('click',()=>setZoom(S.zoom*1.25));
document.getElementById('btnZoomOut').addEventListener('click',()=>setZoom(S.zoom/1.25));
document.getElementById('btnZoomFit').addEventListener('click',fitZoom);
VP.addEventListener('wheel',e=>{ if(e.ctrlKey||e.metaKey){ e.preventDefault(); setZoom(S.zoom*(e.deltaY<0?1.1:.9)); } },{passive:false});

// Header buttons
document.getElementById('btnUndo').addEventListener('click',undo);
document.getElementById('btnRedo').addEventListener('click',redo);
document.getElementById('mUndo')?.addEventListener('click',undo);
document.getElementById('mRedo')?.addEventListener('click',redo);
document.getElementById('btnClear').addEventListener('click',()=>{
  if(!confirm('Clear all layers?'))return;
  S.layers=[]; S.selId=null; S.paintId=null; LC=0;
  addFill('#ffffff'); renderAll(); refreshLayerList(); populateInspector(); pushHistory();
});
document.getElementById('btnNewCanvas').addEventListener('click',()=>document.getElementById('newModal').classList.add('open'));
document.getElementById('btnDownload').addEventListener('click',()=>{ updateDlSize(); document.getElementById('dlModal').classList.add('open'); });
document.getElementById('mDownload')?.addEventListener('click',()=>{ updateDlSize(); document.getElementById('dlModal').classList.add('open'); });
document.getElementById('btnAddPhoto').addEventListener('click',loadFile);
document.getElementById('mAddPhoto')?.addEventListener('click',loadFile);

// Canvas bar
document.getElementById('cPreset').addEventListener('change',e=>{
  if(!e.target.value)return;
  const[w,h]=e.target.value.split('x').map(Number);
  document.getElementById('cW').value=w; document.getElementById('cH').value=h; e.target.value='';
});
document.getElementById('btnApplySize').addEventListener('click',()=>{
  const w=+document.getElementById('cW').value, h=+document.getElementById('cH').value;
  if(w<10||h<10)return;
  if(!confirm(`Resize canvas to ${w}×${h}? Content will be flattened.`))return;
  setCanvasSize(w,h,true); updateDlSize();
});

// Layer panel
document.getElementById('iAddPhoto').addEventListener('click',loadFile);
document.getElementById('iAddText').addEventListener('click',()=>switchTab('text'));
document.getElementById('iAddShape').addEventListener('click',()=>switchTab('shape'));
document.getElementById('iDelLayer').addEventListener('click',delSelected);

// Props tab
document.getElementById('pOpacity').addEventListener('input',e=>{
  document.getElementById('pOpacityVal').textContent=e.target.value+'%';
  const l=selLayer(); if(l){l.opacity=+e.target.value; renderAll();}
});
document.getElementById('pBlend').addEventListener('change',e=>{
  const l=selLayer(); if(l){l.blend=e.target.value; renderAll();}
});
document.getElementById('pRotate').addEventListener('input',e=>{
  document.getElementById('pRotateVal').textContent=e.target.value+'°';
  const l=selLayer(); if(l){l.rot=+e.target.value; renderAll();}
});
document.getElementById('btnApplyProps').addEventListener('click',()=>{
  const l=selLayer(); if(!l)return;
  l.x=+document.getElementById('pX').value; l.y=+document.getElementById('pY').value;
  const nw=+document.getElementById('pW').value, nh=+document.getElementById('pH').value;
  if(nw>0)l.w=nw; if(nh>0)l.h=nh;
  renderAll(); pushHistory(); showToast('Applied!','ok');
});

// Text tab — live
['tContent','tSize','tLineH','tStrokeW','tShadowBlur','tShadowX','tShadowY','tBgAlpha','tBgPad'].forEach(id=>{
  document.getElementById(id).addEventListener('input',liveText);
});
['tFont','tWeight','tStyle'].forEach(id=>document.getElementById(id).addEventListener('change',liveText));
['tColor','tStrokeColor','tShadowColor','tBgColor'].forEach(id=>document.getElementById(id).addEventListener('input',liveText));
document.querySelectorAll('[data-align]').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('[data-align]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); S.textAlign=b.dataset.align; liveText();
  });
});
document.getElementById('btnTextAction').addEventListener('click',()=>{
  const l=selLayer();
  if(l&&l.type==='text'){
    Object.assign(l,readTextFields());
    const m=measureText(l); l.w=m.w; l.h=m.h;
    l.name='Text: '+l.content.slice(0,14);
    renderAll(); refreshLayerList(); pushHistory(); showToast('Text updated!','ok');
  } else {
    const content=document.getElementById('tContent').value.trim();
    if(!content)return showToast('Write some text first!','err');
    addTextLayer({ ...readTextFields(), content });
    pushHistory(); showToast('Text added!','ok');
  }
});

// Shape tab — live
document.querySelectorAll('.sgbtn').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.sgbtn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); S.selShape=b.dataset.shape; liveShape();
  });
});
['sFill','sStroke'].forEach(id=>document.getElementById(id).addEventListener('input',liveShape));
['sStrokeW','sW','sH'].forEach(id=>document.getElementById(id).addEventListener('input',liveShape));
document.getElementById('btnShapeAction').addEventListener('click',()=>{
  const l=selLayer();
  if(l&&l.type==='shape'){
    liveShape(); pushHistory(); showToast('Shape updated!','ok');
  } else {
    addShapeLayer({
      shape:S.selShape,
      fill: document.getElementById('sFill').value,
      stroke:document.getElementById('sStroke').value,
      strokeW:+document.getElementById('sStrokeW').value,
      w:+document.getElementById('sW').value,
      h:+document.getElementById('sH').value,
    });
    pushHistory(); showToast('Shape added!','ok');
  }
});

// Adjust tab
const adjIds=['aBright','aContrast','aSat','aHue','aBlur','aSepia','aInvert','aGray'];
const adjSuf=['','','','°','px','%','%','%'];
adjIds.forEach((id,i)=>{
  document.getElementById(id).addEventListener('input',e=>{
    document.getElementById(id+'V').textContent=e.target.value+adjSuf[i];
  });
});
document.getElementById('btnApplyAdj').addEventListener('click',()=>{
  const l=selLayer(); if(!l)return showToast('Select a layer first','err');
  const b=+document.getElementById('aBright').value;
  const con=+document.getElementById('aContrast').value;
  const sat=+document.getElementById('aSat').value;
  l.cssFilter=`brightness(${1+b/150}) contrast(${1+con/100}) saturate(${1+sat/100}) hue-rotate(${document.getElementById('aHue').value}deg) blur(${document.getElementById('aBlur').value}px) sepia(${document.getElementById('aSepia').value/100}) invert(${document.getElementById('aInvert').value/100}) grayscale(${document.getElementById('aGray').value/100})`;
  renderAll(); pushHistory(); showToast('Filter applied!','ok');
});
document.getElementById('btnResetAdj').addEventListener('click',()=>{
  adjIds.forEach(id=>document.getElementById(id).value=0);
  adjIds.forEach((id,i)=>document.getElementById(id+'V').textContent='0'+adjSuf[i]);
  const l=selLayer(); if(l){l.cssFilter=''; renderAll();}
});
document.querySelectorAll('.fltbtn').forEach(b=>{
  b.addEventListener('click',()=>{
    const l=selLayer(); if(!l)return showToast('Select a layer first','err');
    document.querySelectorAll('.fltbtn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); l.cssFilter=b.dataset.f||'';
    renderAll(); pushHistory(); showToast('Filter applied!','ok');
  });
});

// Inspector tabs
document.querySelectorAll('.itab').forEach(t=>{
  t.addEventListener('click',()=>switchTab(t.dataset.tab));
});

// Download modal
document.getElementById('dlCancel').addEventListener('click',()=>document.getElementById('dlModal').classList.remove('open'));
document.getElementById('dlScale').addEventListener('input',updateDlSize);
document.querySelectorAll('#dlQuality .bgtbtn').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('#dlQuality .bgtbtn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); S.dlQuality=+b.dataset.q;
  });
});
document.getElementById('dlConfirm').addEventListener('click',()=>{
  const fmt=document.getElementById('dlFmt').value;
  const sc=+document.getElementById('dlScale').value||1;
  const name=document.getElementById('dlName').value||'pixelforge';
  document.getElementById('dlModal').classList.remove('open');
  download(fmt, S.dlQuality, sc, name);
});
document.getElementById('dlModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) e.currentTarget.classList.remove('open'); });

// New canvas modal
document.getElementById('nCancel').addEventListener('click',()=>document.getElementById('newModal').classList.remove('open'));
document.getElementById('nPreset').addEventListener('change',e=>{
  if(!e.target.value)return;
  const[w,h]=e.target.value.split(',').map(Number);
  document.getElementById('nW').value=w; document.getElementById('nH').value=h; e.target.value='';
});
document.getElementById('nConfirm').addEventListener('click',()=>{
  const w=+document.getElementById('nW').value, h=+document.getElementById('nH').value;
  const bg=document.getElementById('nBg').value;
  if(!confirm(`Create new ${w}×${h} canvas? All layers will be lost.`))return;
  document.getElementById('newModal').classList.remove('open');
  S.layers=[]; S.selId=null; S.paintId=null; LC=0;
  S.w=w; S.h=h;
  MC.width=w; MC.height=h; OC.width=w; OC.height=h;
  CW.style.width=w+'px'; CW.style.height=h+'px';
  document.getElementById('cW').value=w; document.getElementById('cH').value=h;
  addFill(bg); renderAll(); refreshLayerList(); populateInspector(); pushHistory(); fitZoom(); updateDlSize();
  showToast(`Canvas ${w}×${h} created!`,'ok');
});
document.getElementById('newModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) e.currentTarget.classList.remove('open'); });

// Drag & drop
document.body.addEventListener('dragover',e=>e.preventDefault());
document.body.addEventListener('drop',e=>{
  e.preventDefault();
  const f=e.dataTransfer.files[0]; if(!f||!f.type.startsWith('image/'))return;
  const r=new FileReader();
  r.onload=async ev=>{ const img=await loadImg(ev.target.result); if(img){addImage(img,f.name.replace(/\.[^.]+$/,'')); pushHistory();} };
  r.readAsDataURL(f);
});

// Paste
window.addEventListener('paste',e=>{
  for(const item of (e.clipboardData?.items||[])){
    if(item.type.startsWith('image/')){
      const r=new FileReader();
      r.onload=async ev=>{ const img=await loadImg(ev.target.result); if(img){addImage(img,'Pasted');pushHistory();showToast('Pasted!','ok');} };
      r.readAsDataURL(item.getAsFile()); break;
    }
  }
});

// Keyboard
window.addEventListener('keydown',e=>{
  const tag=e.target.tagName;
  const noInput = tag!=='INPUT'&&tag!=='TEXTAREA'&&tag!=='SELECT';
  if(e.ctrlKey||e.metaKey){
    if(e.key.toLowerCase()==='z'){ e.preventDefault(); undo(); return; }
    if(e.key.toLowerCase()==='y'){ e.preventDefault(); redo(); return; }
    if(e.key.toLowerCase()==='s'){ e.preventDefault(); updateDlSize(); document.getElementById('dlModal').classList.add('open'); return; }
    if(e.key==='+'||e.key==='='){ e.preventDefault(); setZoom(S.zoom*1.2); return; }
    if(e.key==='-'){ e.preventDefault(); setZoom(S.zoom/1.2); return; }
    if(e.key==='0'){ e.preventDefault(); fitZoom(); return; }
  }
  if(!noInput) return;
  const map={v:'select',t:'text',b:'brush',e:'eraser',f:'fill',i:'eyedropper'};
  if(map[e.key]){ setTool(map[e.key]); return; }
  if(e.key==='Delete'||e.key==='Backspace'){ delSelected(); return; }
  if(e.key==='Escape'){ S.ia=null; S.painting=false; oct.clearRect(0,0,S.w,S.h); }
  // nudge selected layer with arrow keys
  if(e.key.startsWith('Arrow')){
    const l=selLayer(); if(!l||l.type==='fill')return;
    e.preventDefault();
    const d=e.shiftKey?10:1;
    if(e.key==='ArrowLeft')  l.x-=d;
    if(e.key==='ArrowRight') l.x+=d;
    if(e.key==='ArrowUp')    l.y-=d;
    if(e.key==='ArrowDown')  l.y+=d;
    renderAll(); syncPropsFields(l);
  }
});

// Mobile: tap inspector toggle
document.getElementById('mDownload')?.addEventListener('click',()=>{});
// simple mobile inspector open via text/layer tap handled by inspector being visible

// Init
window.addEventListener('load', init);
