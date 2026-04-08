import type { GCodeCommand } from "./types.js";

/**
 * Represents a single line segment in the print path.
 */
export interface PathSegment {
  /** Starting X coordinate */
  x1: number;
  /** Starting Y coordinate */
  y1: number;
  /** Ending X coordinate */
  x2: number;
  /** Ending Y coordinate */
  y2: number;
  /** Z height (layer height) of this segment */
  z: number;
  /** Whether this segment involves filament extrusion */
  extrusion: boolean;
  /** Feedrate (speed) in mm/min */
  feedrate: number;
}

/**
 * Represents a single layer containing path segments.
 */
export interface LayerPath {
  /** Z height of this layer */
  z: number;
  /** Array of path segments in this layer */
  segments: PathSegment[];
}

/**
 * Configuration options for the G-code visualizer HTML generation.
 */
export interface VisualizerOptions {
  /** Canvas width in pixels. Default: 800 */
  width?: number;
  /** Canvas height in pixels. Default: 600 */
  height?: number;
  /** Page title. Default: "G-code Visualizer" */
  title?: string;
  /** Background color of the canvas. Default: "#1a1a1a" */
  backgroundColor?: string;
  /** Color for extrusion moves. Default: "#00ff00" */
  extrusionColor?: string;
  /** Color for travel moves. Default: "#ff0000" */
  travelColor?: string;
  /** Line width for drawing paths. Default: 2 */
  lineWidth?: number;
}

/**
 * Extracts layer paths from parsed G-code commands.
 * Tracks position state including absolute/relative positioning modes and
 * handles G92 position resets.
 * 
 * @param commands - Array of parsed G-code commands
 * @returns Array of layer paths, sorted by Z height
 */
export function extractLayerPaths(commands: readonly GCodeCommand[]): LayerPath[] {
  const layerMap = new Map<number, PathSegment[]>();
  
  let x = 0;
  let y = 0;
  let z = 0;
  let e = 0;
  let absolutePosition = true;
  let absoluteExtrusion = true;
  let currentFeedrate = 0;
  
  for (const cmd of commands) {
    // Handle positioning mode changes
    if (cmd.type === 'G') {
      if (cmd.code === 90) {
        absolutePosition = true;
        absoluteExtrusion = true;
      } else if (cmd.code === 91) {
        absolutePosition = false;
        absoluteExtrusion = false;
      } else if (cmd.code === 92) {
        // Set position - update coordinates without creating segments
        if (cmd.params.X !== undefined) x = cmd.params.X;
        if (cmd.params.Y !== undefined) y = cmd.params.Y;
        if (cmd.params.Z !== undefined) z = cmd.params.Z;
        if (cmd.params.E !== undefined) e = cmd.params.E;
        continue;
      }
    }
    
    // Handle extrusion mode changes (Marlin specific)
    if (cmd.type === 'M') {
      if (cmd.code === 82) absoluteExtrusion = true;
      else if (cmd.code === 83) absoluteExtrusion = false;
    }
    
    // Process movement commands
    if (cmd.type === 'G' && (cmd.code === 0 || cmd.code === 1)) {
      const params = cmd.params;
      
      // Calculate target positions
      let newX = x;
      let newY = y;
      let newZ = z;
      let newE = e;
      
      if (params.X !== undefined) {
        newX = absolutePosition ? params.X : x + params.X;
      }
      if (params.Y !== undefined) {
        newY = absolutePosition ? params.Y : y + params.Y;
      }
      if (params.Z !== undefined) {
        newZ = absolutePosition ? params.Z : z + params.Z;
      }
      if (params.E !== undefined) {
        newE = absoluteExtrusion ? params.E : e + params.E;
      }
      if (params.F !== undefined) {
        currentFeedrate = params.F;
      }
      
      // Check if this is an XY movement (creates a visible segment)
      const hasXYMove = params.X !== undefined || params.Y !== undefined;
      
      if (hasXYMove) {
        const isExtruding = newE > e;
        
        const segment: PathSegment = {
          x1: x,
          y1: y,
          x2: newX,
          y2: newY,
          z: newZ,
          extrusion: isExtruding,
          feedrate: currentFeedrate,
        };
        
        // Group by Z height (rounded to 3 decimal places to avoid floating point issues)
        const layerZ = Math.round(newZ * 1000) / 1000;
        if (!layerMap.has(layerZ)) {
          layerMap.set(layerZ, []);
        }
        layerMap.get(layerZ)!.push(segment);
      }
      
      // Update current state
      x = newX;
      y = newY;
      z = newZ;
      e = newE;
    }
  }
  
  // Convert map to sorted array by Z height
  const sortedZs = Array.from(layerMap.keys()).sort((a, b) => a - b);
  return sortedZs.map(z => ({
    z,
    segments: layerMap.get(z)!,
  }));
}

/**
 * Generates an interactive HTML visualizer for the G-code.
 * Creates a standalone HTML file with Canvas 2D rendering, layer controls,
 * and interactive pan/zoom capabilities.
 * 
 * @param commands - Array of parsed G-code commands
 * @param options - Visualizer configuration options
 * @returns Complete HTML document as a string
 */
export function generateVisualizerHTML(
  commands: readonly GCodeCommand[],
  options: VisualizerOptions = {}
): string {
  const {
    width = 800,
    height = 600,
    title = 'G-code Visualizer',
    backgroundColor = '#1a1a1a',
    extrusionColor = '#00ff00',
    travelColor = '#ff0000',
    lineWidth = 2,
  } = options;
  
  const layers = extractLayerPaths(commands);
  
  // Escape HTML special characters to prevent XSS
  const escapeHtml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };
  
  const escapedTitle = escapeHtml(title);
  
  // Calculate bounds for auto-scaling
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const layer of layers) {
    for (const seg of layer.segments) {
      minX = Math.min(minX, seg.x1, seg.x2);
      maxX = Math.max(maxX, seg.x1, seg.x2);
      minY = Math.min(minY, seg.y1, seg.y2);
      maxY = Math.max(maxY, seg.y1, seg.y2);
    }
  }
  
  // Default bounds if no segments found
  if (!isFinite(minX)) {
    minX = 0;
    maxX = 100;
    minY = 0;
    maxY = 100;
  }
  
  const layersJson = JSON.stringify(layers);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #2a2a2a;
      color: #fff;
    }
    #container {
      max-width: ${width + 40}px;
      margin: 0 auto;
    }
    h1 {
      text-align: center;
      margin-bottom: 20px;
      font-size: 1.5rem;
    }
    #canvas-container {
      position: relative;
      background: ${backgroundColor};
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    }
    canvas {
      display: block;
      cursor: crosshair;
    }
    #controls {
      margin-top: 20px;
      padding: 15px;
      background: #333;
      border-radius: 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
      align-items: center;
      justify-content: center;
    }
    .control-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    label {
      font-size: 0.9rem;
      color: #ccc;
    }
    input[type="range"] {
      width: 200px;
    }
    button {
      padding: 8px 16px;
      background: #4a9eff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    button:hover {
      background: #3a8eef;
    }
    button.active {
      background: #2a7edf;
    }
    #info {
      margin-top: 10px;
      font-size: 0.85rem;
      color: #aaa;
      text-align: center;
    }
    .empty-state {
      text-align: center;
      padding: 40px;
      color: #666;
      background: ${backgroundColor};
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div id="container">
    <h1>${escapedTitle}</h1>
    ${layers.length === 0 ? '<div class="empty-state">No layers found</div>' : `
    <div id="canvas-container">
      <canvas id="gcv" width="${width}" height="${height}"></canvas>
    </div>
    <div id="controls">
      <div class="control-group">
        <label for="layerSlider">Layer:</label>
        <input type="range" id="layerSlider" min="0" max="${layers.length - 1}" value="${layers.length - 1}">
        <span id="layerInfo">${layers.length - 1} / ${layers.length - 1}</span>
      </div>
      <div class="control-group">
        <button id="travelBtn" class="active">Show Travel</button>
      </div>
      <div class="control-group">
        <button id="resetBtn">Reset View</button>
      </div>
    </div>
    <div id="info">Scroll to zoom, drag to pan</div>
    `}
  </div>
  
  <script>
    const layers = ${layersJson};
    const bounds = { minX: ${minX}, maxX: ${maxX}, minY: ${minY}, maxY: ${maxY} };
    const config = {
      extrusionColor: '${extrusionColor}',
      travelColor: '${travelColor}',
      lineWidth: ${lineWidth},
      width: ${width},
      height: ${height},
      backgroundColor: '${backgroundColor}'
    };
    
    if (layers.length > 0) {
      const canvas = document.getElementById('gcv');
      const ctx = canvas.getContext('2d');
      const slider = document.getElementById('layerSlider');
      const layerInfo = document.getElementById('layerInfo');
      const travelBtn = document.getElementById('travelBtn');
      const resetBtn = document.getElementById('resetBtn');
      
      let currentLayer = layers.length - 1;
      let showTravel = true;
      let scale = 1;
      let offsetX = 0;
      let offsetY = 0;
      let isDragging = false;
      let lastX = 0;
      let lastY = 0;
      
      function fitToScreen() {
        const padding = 40;
        const availWidth = config.width - padding * 2;
        const availHeight = config.height - padding * 2;
        const width = bounds.maxX - bounds.minX || 100;
        const height = bounds.maxY - bounds.minY || 100;
        const scaleX = availWidth / width;
        const scaleY = availHeight / height;
        scale = Math.min(scaleX, scaleY, 1000);
        offsetX = (config.width - width * scale) / 2 - bounds.minX * scale;
        offsetY = (config.height - height * scale) / 2 - bounds.minY * scale;
      }
      
      function transform(x, y) {
        return {
          x: x * scale + offsetX,
          y: config.height - (y * scale + offsetY)
        };
      }
      
      function draw() {
        ctx.fillStyle = config.backgroundColor;
        ctx.fillRect(0, 0, config.width, config.height);
        
        ctx.lineWidth = config.lineWidth;
        ctx.lineCap = 'round';
        
        // Draw all layers up to current layer
        for (let i = 0; i <= currentLayer; i++) {
          const layer = layers[i];
          const isCurrentLayer = i === currentLayer;
          const alpha = isCurrentLayer ? 1.0 : 0.3;
          
          for (const seg of layer.segments) {
            if (!seg.extrusion && !showTravel) continue;
            
            const start = transform(seg.x1, seg.y1);
            const end = transform(seg.x2, seg.y2);
            
            ctx.strokeStyle = seg.extrusion ? config.extrusionColor : config.travelColor;
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1.0;
      }
      
      slider.addEventListener('input', (e) => {
        currentLayer = parseInt(e.target.value);
        layerInfo.textContent = currentLayer + ' / ' + (layers.length - 1);
        draw();
      });
      
      travelBtn.addEventListener('click', () => {
        showTravel = !showTravel;
        travelBtn.classList.toggle('active');
        draw();
      });
      
      resetBtn.addEventListener('click', () => {
        fitToScreen();
        draw();
      });
      
      canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
      });
      
      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        offsetX += dx;
        offsetY -= dy;
        lastX = e.clientX;
        lastY = e.clientY;
        draw();
      });
      
      window.addEventListener('mouseup', () => {
        isDragging = false;
      });
      
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        scale *= zoomFactor;
        draw();
      });
      
      fitToScreen();
      draw();
    }
  </script>
</body>
</html>`;
}
