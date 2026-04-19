# PixelForge — Photo Editor

Web-based photo editor yang powerful dan ringan. Deploy di GitHub Pages / Cloudflare Pages tanpa backend.

## ✨ Fitur

### Tools
- **Select & Move** — Pilih dan pindah layer
- **Brush** — Lukis bebas dengan kontrol size & opacity
- **Eraser** — Hapus bagian dari paint layer
- **Text Tool** — Klik di mana saja untuk tambah teks
- **Fill** — Flood fill warna
- **Shape** — Rect, Rounded Rect, Circle, Ellipse, Triangle, Star, Line, Arrow
- **Crop** — Crop canvas

### Layers
- Layer system lengkap (image, text, shape, paint)
- Visibility toggle
- Opacity per-layer
- 16 Blend Modes (Normal, Multiply, Screen, Overlay, dll)
- Posisi X/Y, ukuran, dan rotasi
- Drag-to-move layer di canvas

### Teks
- 10+ font pilihan
- Font size, weight (thin–black), italic
- Text align (left/center/right)
- Line height
- **Stroke** dengan custom color & size
- **Drop Shadow** (color, blur, offset X/Y)
- **Background highlight** (color, opacity, padding)

### Adjustments
- Brightness, Contrast, Saturasi, Hue Rotate
- Blur, Sepia, Invert, Grayscale
- 10 Quick Filters (B&W, Vintage, Vivid, Drama, dll)

### Download
- Format: PNG, JPEG, WebP
- Kualitas: Low / Mid / High / Max
- Custom scale (0.1× hingga 4×)
- Custom nama file

### Canvas
- Atur ukuran bebas
- Preset: FHD, HD, IG Square, Story, dll
- Zoom in/out/fit (Ctrl+scroll)
- Drag & drop foto langsung ke canvas
- Paste gambar dari clipboard (Ctrl+V)

### Shortcuts
| Key | Aksi |
|-----|------|
| V | Select tool |
| M | Move tool |
| T | Text tool |
| B | Brush |
| E | Eraser |
| F | Fill |
| S | Shape |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| Ctrl+S | Download |
| Ctrl+± | Zoom |
| Ctrl+0 | Fit zoom |
| Delete | Hapus layer |

## 🚀 Deploy

### Cloudflare Pages
1. Push ke GitHub repo
2. Buka [Cloudflare Pages](https://pages.cloudflare.com/)
3. Connect repo, pilih branch `main`
4. Build command: *(kosong)*
5. Output directory: `/` (root)
6. Deploy!

### GitHub Pages
1. Push ke GitHub repo  
2. Settings → Pages → Source: `main` branch, root `/`
3. Akses di `https://username.github.io/repo-name`

## 📁 File Structure
```
├── index.html   — Markup
├── style.css    — Dark industrial styling
├── editor.js    — Editor engine
└── README.md
```

Pure HTML/CSS/JS — zero dependencies, zero build step.
