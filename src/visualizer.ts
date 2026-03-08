import type { GCodeCommand } from "./types.js";

/** A single segment of a toolpath within a layer. */
export interface PathSegment {
  /** Start X coordinate. */
  readonly x1: number;
  /** Start Y coordinate. */
  readonly y1: number;
  /** End X coordinate. */
  readonly x2: number;
  /** End Y coordinate. */
  readonly y2: number;
  /** Whether filament is being extruded during this move. */
  readonly extrusion: boolean;
  /** Feedrate (mm/min) for this segment. */
  readonly feedrate: number;
}

/** All path segments for a single layer. */
export interface LayerPath {
  /** Layer index (0-based). */
  readonly index: number;
  /** Z height in millimeters. */
  readonly z: number;
  /** Toolpath segments in this layer. */
  readonly segments: readonly PathSegment[];
}

/** Options for the interactive visualizer HTML output. */
export interface VisualizerOptions {
  /** Canvas width in pixels. Default: 800. */
  readonly width?: number;
  /** Canvas height in pixels. Default: 600. */
  readonly height?: number;
  /** Background color. Default: "#1a1a2e". */
  readonly backgroundColor?: string;
  /** Color for travel (non-extrusion) moves. Default: "rgba(100,100,100,0.3)". */
  readonly travelColor?: string;
  /** Color for extrusion moves. Default: "#00D26A". */
  readonly extrusionColor?: string;
  /** Whether to show travel moves. Default: true. */
  readonly showTravel?: boolean;
  /** Page title. Default: "G-code Visualizer". */
  readonly title?: string;
}

const DEFAULT_OPTIONS: Required<VisualizerOptions> = {
  width: 800,
  height: 600,
  backgroundColor: "#1a1a2e",
  travelColor: "rgba(100,100,100,0.3)",
  extrusionColor: "#00D26A",
  showTravel: true,
  title: "G-code Visualizer",
};

/**
 * Extract layer-by-layer toolpaths from parsed G-code commands.
 * Groups segments by Z height changes, tracking position in both
 * absolute and relative modes.
 */
export function extractLayerPaths(commands: readonly GCodeCommand[]): LayerPath[] {
  const layers: LayerPath[] = [];
  let currentZ = 0;
  let currentX = 0;
  let currentY = 0;
  let currentF = 1000;
  let currentE = 0;
  let absolutePos = true;
  let absoluteExt = true;
  let segments: PathSegment[] = [];

  const pushLayer = () => {
    if (segments.length > 0) {
      layers.push({ index: layers.length, z: currentZ, segments: [...segments] });
      segments = [];
    }
  };

  for (const cmd of commands) {
    if (cmd.type === "G") {
      if (cmd.code === 90) { absolutePos = true; absoluteExt = true; continue; }
      if (cmd.code === 91) { absolutePos = false; absoluteExt = false; continue; }
      if (cmd.code === 92) {
        if (cmd.params.X !== undefined) currentX = cmd.params.X;
        if (cmd.params.Y !== undefined) currentY = cmd.params.Y;
        if (cmd.params.Z !== undefined) currentZ = cmd.params.Z;
        if (cmd.params.E !== undefined) currentE = cmd.params.E;
        continue;
      }

      if (cmd.code === 0 || cmd.code === 1) {
        const newX = cmd.params.X !== undefined
          ? (absolutePos ? cmd.params.X : currentX + cmd.params.X)
          : currentX;
        const newY = cmd.params.Y !== undefined
          ? (absolutePos ? cmd.params.Y : currentY + cmd.params.Y)
          : currentY;
        const newZ = cmd.params.Z !== undefined
          ? (absolutePos ? cmd.params.Z : currentZ + cmd.params.Z)
          : currentZ;
        const newF = cmd.params.F ?? currentF;

        let extruding = false;
        if (cmd.params.E !== undefined) {
          const newE = absoluteExt ? cmd.params.E : currentE + cmd.params.E;
          extruding = newE > currentE;
          currentE = newE;
        }

        // Detect layer change
        if (Math.abs(newZ - currentZ) > 0.001) {
          pushLayer();
          currentZ = newZ;
        }

        // Only record if there is XY movement
        if (Math.abs(newX - currentX) > 0.0001 || Math.abs(newY - currentY) > 0.0001) {
          segments.push({
            x1: currentX,
            y1: currentY,
            x2: newX,
            y2: newY,
            extrusion: extruding,
            feedrate: newF,
          });
        }

        currentX = newX;
        currentY = newY;
        currentF = newF;
      }
    } else if (cmd.type === "M") {
      if (cmd.code === 82) absoluteExt = true;
      if (cmd.code === 83) absoluteExt = false;
    }
  }

  // Push final layer
  pushLayer();

  return layers;
}

/**
 * Generate a self-contained interactive HTML page that visualizes
 * G-code toolpaths layer by layer on an HTML5 canvas.
 *
 * Features:
 * - Layer slider to step through layers
 * - Pan and zoom with mouse
 * - Toggle travel moves
 * - Extrusion vs travel color coding
 * - Layer stats panel
 */
export function generateVisualizerHTML(
  commands: readonly GCodeCommand[],
  options: VisualizerOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const layers = extractLayerPaths(commands);
  const layersJSON = JSON.stringify(layers);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(opts.title)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: ${opts.backgroundColor}; color: #e0e0e0; font-family: 'Inter', system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 20px; }
h1 { font-size: 1.4rem; margin-bottom: 12px; color: #fff; }
.controls { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; justify-content: center; }
.controls label { font-size: 0.85rem; }
.controls input[type=range] { width: 260px; accent-color: ${opts.extrusionColor}; }
.controls button { background: #2a2a4a; border: 1px solid #444; color: #e0e0e0; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; }
.controls button:hover { background: #3a3a5a; }
.controls button.active { background: ${opts.extrusionColor}; color: #000; }
canvas { border: 1px solid #333; border-radius: 6px; cursor: grab; }
canvas:active { cursor: grabbing; }
.stats { margin-top: 12px; display: flex; gap: 24px; font-size: 0.85rem; flex-wrap: wrap; justify-content: center; }
.stat-item { background: rgba(255,255,255,0.05); padding: 6px 14px; border-radius: 4px; }
.stat-val { color: ${opts.extrusionColor}; font-weight: 600; }
</style>
</head>
<body>
<h1>${escapeHTML(opts.title)}</h1>
<div class="controls">
  <label>Layer: <span id="layerNum">0</span> / <span id="layerTotal">0</span></label>
  <input type="range" id="layerSlider" min="0" max="0" value="0">
  <label>Z: <span id="zHeight">0.00</span>mm</label>
  <button id="travelBtn" class="active">Travel</button>
  <button id="resetBtn">Reset View</button>
</div>
<canvas id="canvas" width="${opts.width}" height="${opts.height}"></canvas>
<div class="stats">
  <div class="stat-item">Layers: <span class="stat-val" id="totalLayers">0</span></div>
  <div class="stat-item">Segments: <span class="stat-val" id="segCount">0</span></div>
  <div class="stat-item">Extrusions: <span class="stat-val" id="extCount">0</span></div>
  <div class="stat-item">Travels: <span class="stat-val" id="travCount">0</span></div>
</div>
<script>
(function(){
  const layers = ${layersJSON};
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const slider = document.getElementById('layerSlider');
  const layerNum = document.getElementById('layerNum');
  const layerTotal = document.getElementById('layerTotal');
  const zHeight = document.getElementById('zHeight');
  const travelBtn = document.getElementById('travelBtn');
  const resetBtn = document.getElementById('resetBtn');
  const totalLayersEl = document.getElementById('totalLayers');
  const segCountEl = document.getElementById('segCount');
  const extCountEl = document.getElementById('extCount');
  const travCountEl = document.getElementById('travCount');

  let showTravel = ${opts.showTravel};
  let currentLayer = 0;
  let panX = 0, panY = 0, zoom = 1;
  let dragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

  if (layers.length === 0) { ctx.fillStyle='#888'; ctx.font='16px sans-serif'; ctx.fillText('No layers found',20,30); return; }

  slider.max = layers.length - 1;
  layerTotal.textContent = layers.length - 1;
  totalLayersEl.textContent = layers.length;

  // Compute bounds
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for (const l of layers) for (const s of l.segments) {
    minX=Math.min(minX,s.x1,s.x2); maxX=Math.max(maxX,s.x1,s.x2);
    minY=Math.min(minY,s.y1,s.y2); maxY=Math.max(maxY,s.y1,s.y2);
  }
  const rangeX=maxX-minX||1, rangeY=maxY-minY||1;
  const pad=40;

  function resetView() {
    const scaleX=(canvas.width-2*pad)/rangeX;
    const scaleY=(canvas.height-2*pad)/rangeY;
    zoom=Math.min(scaleX,scaleY);
    panX=pad-minX*zoom+(canvas.width-2*pad-rangeX*zoom)/2;
    panY=pad-minY*zoom+(canvas.height-2*pad-rangeY*zoom)/2;
  }
  resetView();

  function draw() {
    ctx.fillStyle='${opts.backgroundColor}';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    const layer=layers[currentLayer];
    if(!layer) return;
    let ext=0,trav=0;
    for(const s of layer.segments){
      if(!s.extrusion){ trav++; if(!showTravel) continue;
        ctx.strokeStyle='${opts.travelColor}'; ctx.lineWidth=0.5;
      } else { ext++;
        ctx.strokeStyle='${opts.extrusionColor}'; ctx.lineWidth=1.5;
      }
      ctx.beginPath();
      ctx.moveTo(s.x1*zoom+panX, canvas.height-(s.y1*zoom+panY));
      ctx.lineTo(s.x2*zoom+panX, canvas.height-(s.y2*zoom+panY));
      ctx.stroke();
    }
    segCountEl.textContent=layer.segments.length;
    extCountEl.textContent=ext;
    travCountEl.textContent=trav;
  }

  slider.addEventListener('input',function(){
    currentLayer=parseInt(this.value);
    layerNum.textContent=currentLayer;
    zHeight.textContent=layers[currentLayer]?layers[currentLayer].z.toFixed(2):'0.00';
    draw();
  });

  travelBtn.addEventListener('click',function(){
    showTravel=!showTravel;
    this.classList.toggle('active',showTravel);
    draw();
  });

  resetBtn.addEventListener('click',function(){ resetView(); draw(); });

  canvas.addEventListener('mousedown',function(e){ dragging=true; dragStartX=e.clientX; dragStartY=e.clientY; panStartX=panX; panStartY=panY; });
  canvas.addEventListener('mousemove',function(e){ if(!dragging) return; panX=panStartX+(e.clientX-dragStartX); panY=panStartY-(e.clientY-dragStartY); draw(); });
  canvas.addEventListener('mouseup',function(){ dragging=false; });
  canvas.addEventListener('mouseleave',function(){ dragging=false; });
  canvas.addEventListener('wheel',function(e){
    e.preventDefault();
    const rect=canvas.getBoundingClientRect();
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;
    const factor=e.deltaY<0?1.1:0.9;
    const wx=(mx-panX)/zoom, wy=(canvas.height-my-panY)/zoom;
    zoom*=factor;
    panX=mx-wx*zoom; panY=canvas.height-my-wy*zoom;
    draw();
  },{passive:false});

  layerNum.textContent='0';
  zHeight.textContent=layers[0]?layers[0].z.toFixed(2):'0.00';
  draw();
})();
</script>
</body>
</html>`;
}

function escapeHTML(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
