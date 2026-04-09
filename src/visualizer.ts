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
  /** Whether this segment involves filament extrusion */
  extrusion: boolean;
  /** Feedrate (speed) in mm/min */
  feedrate: number;
}

/**
 * Represents a single layer containing path segments.
 */
export interface LayerPath {
  /** Z-height of the layer in millimeters */
  z: number;
  /** Array of path segments in this layer */
  segments: PathSegment[];
}

/**
 * Options for customizing the generated visualizer HTML.
 */
export interface VisualizerOptions {
  /** Canvas width in pixels. Default: 800 */
  width?: number;
  /** Canvas height in pixels. Default: 600 */
  height?: number;
  /** Page title. Default: "G-code Visualizer" */
  title?: string;
  /** Background color CSS value. Default: "#1a1a1a" */
  backgroundColor?: string;
  /** Extrusion line color CSS value. Default: "#00ff00" */
  extrusionColor?: string;
  /** Travel line color CSS value. Default: "#ff0000" */
  travelColor?: string;
}

/**
 * Extracts layer paths from parsed G-code commands.
 * Tracks movement commands to build a layer-by-layer representation of the print path,
 * distinguishing between extrusion and travel moves.
 *
 * @param commands - Array of parsed G-code commands
 * @returns Array of layers containing path segments
 */
export function extractLayerPaths(commands: readonly GCodeCommand[]): LayerPath[] {
  const layers: LayerPath[] = [];
  let currentLayer: LayerPath | null = null;

  let x = 0;
  let y = 0;
  let z = 0;
  let e = 0;
  let f = 0;
  let absolutePosition = true;
  let absoluteExtrusion = true;

  for (const cmd of commands) {
    // Handle positioning modes
    if (cmd.type === "G") {
      if (cmd.code === 90) {
        absolutePosition = true;
        absoluteExtrusion = true;
      } else if (cmd.code === 91) {
        absolutePosition = false;
        absoluteExtrusion = false;
      } else if (cmd.code === 92) {
        // Set position - update internal state without creating segments
        if (cmd.params.X !== undefined) x = cmd.params.X;
        if (cmd.params.Y !== undefined) y = cmd.params.Y;
        if (cmd.params.Z !== undefined) z = cmd.params.Z;
        if (cmd.params.E !== undefined) e = cmd.params.E;
        continue;
      }
    }

    // Check for Z change to create new layer
    if (cmd.type === "G" && (cmd.code === 0 || cmd.code === 1) && cmd.params.Z !== undefined) {
      const newZ = absolutePosition ? cmd.params.Z : z + cmd.params.Z;
      if (Math.abs(newZ - z) > 0.01) {
        z = newZ;
        currentLayer = { z: newZ, segments: [] };
        layers.push(currentLayer);
      } else {
        z = newZ;
      }
    }

    // Process movement commands with XY coordinates
    if (cmd.type === "G" && (cmd.code === 0 || cmd.code === 1)) {
      const hasX = cmd.params.X !== undefined;
      const hasY = cmd.params.Y !== undefined;

      if (hasX || hasY) {
        // Ensure we have a layer for this Z
        if (!currentLayer) {
          currentLayer = { z, segments: [] };
          layers.push(currentLayer);
        }

        const startX = x;
        const startY = y;
        const newX = hasX ? (absolutePosition ? cmd.params.X! : x + cmd.params.X!) : x;
        const newY = hasY ? (absolutePosition ? cmd.params.Y! : y + cmd.params.Y!) : y;
        const newF = cmd.params.F !== undefined ? cmd.params.F : f;

        // Check for extrusion by comparing new E value with current
        let extrusion = false;
        if (cmd.params.E !== undefined) {
          const newE = absoluteExtrusion ? cmd.params.E : e + cmd.params.E;
          if (newE > e) {
            extrusion = true;
          }
          e = newE;
        }

        // Add segment to current layer
        currentLayer.segments.push({
          x1: startX,
          y1: startY,
          x2: newX,
          y2: newY,
          extrusion,
          feedrate: newF,
        });

        x = newX;
        y = newY;
      }

      // Update feedrate if provided (even without XY movement)
      if (cmd.params.F !== undefined) {
        f = cmd.params.F;
      }
    }
  }

  return layers;
}

/**
 * Generates a standalone HTML file for visualizing G-code layers.
 * Creates an interactive viewer with layer slider, travel move toggle, and canvas rendering.
 *
 * @param commands - Array of parsed G-code commands
 * @param options - Visualizer customization options
 * @returns Complete HTML document as a string
 */
export function generateVisualizerHTML(
  commands: readonly GCodeCommand[],
  options: VisualizerOptions = {}
): string {
  const {
    width = 800,
    height = 600,
    title = "G-code Visualizer",
    backgroundColor = "#1a1a1a",
    extrusionColor = "#00ff00",
    travelColor = "#ff0000",
  } = options;

  const layers = extractLayerPaths(commands);

  // Escape title for HTML to prevent XSS attacks
  const escapedTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

  if (layers.length === 0) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
      background: ${backgroundColor}; 
      color: #fff; 
      text-align: center; 
      padding: 50px; 
      margin: 0;
    }
    h1 { font-weight: 300; }
  </style>
</head>
<body>
  <h1>${escapedTitle}</h1>
  <p>No layers found</p>
</body>
</html>`;
  }

  // Serialize layers to JSON, escaping for safe embedding in HTML script tag
  const layersJson = JSON.stringify(layers)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

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
      background: ${backgroundColor};
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #container {
      max-width: ${width}px;
      margin: 0 auto;
    }
    canvas {
      border: 1px solid #444;
      background: #000;
      display: block;
      margin: 20px 0;
      width: ${width}px;
      height: ${height}px;
    }
    .controls {
      background: #2a2a2a;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .control-group {
      margin: 10px 0;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    label {
      min-width: 100px;
      font-size: 14px;
      color: #ccc;
    }
    input[type="range"] {
      flex: 1;
      min-width: 200px;
    }
    button {
      background: #444;
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s;
    }
    button:hover {
      background: #555;
    }
    button.active {
      background: #0066cc;
    }
    .info {
      font-size: 12px;
      color: #888;
      margin-top: 10px;
    }
    .legend-item {
      display: inline-block;
      margin-right: 20px;
    }
  </style>
</head>
<body>
  <div id="container">
    <h1>${escapedTitle}</h1>
    <div class="controls">
      <div class="control-group">
        <label for="layerSlider">Layer:</label>
        <input type="range" id="layerSlider" min="0" max="${layers.length - 1}" value="0">
        <span id="layerInfo">1 / ${layers.length}</span>
      </div>
      <div class="control-group">
        <button id="travelBtn" class="active">Show Travel</button>
        <button id="resetBtn">Reset View</button>
      </div>
      <div class="info">
        <span class="legend-item" style="color: ${extrusionColor}">● Extrusion</span>
        <span class="legend-item" style="color: ${travelColor}">● Travel</span>
      </div>
    </div>
    <canvas id="canvas" width="${width}" height="${height}"></canvas>
  </div>
  <script>
    const layers = ${layersJson};
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const layerSlider = document.getElementById('layerSlider');
    const layerInfo = document.getElementById('layerInfo');
    const travelBtn = document.getElementById('travelBtn');
    const resetBtn = document.getElementById('resetBtn');
    
    let showTravel = true;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    
    const extrusionColor = '${extrusionColor}';
    const travelColor = '${travelColor}';
    
    function calculateBounds() {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let hasBounds = false;
      layers.forEach(layer => {
        layer.segments.forEach(seg => {
          minX = Math.min(minX, seg.x1, seg.x2);
          minY = Math.min(minY, seg.y1, seg.y2);
          maxX = Math.max(maxX, seg.x1, seg.x2);
          maxY = Math.max(maxY, seg.y1, seg.y2);
          hasBounds = true;
        });
      });
      if (!hasBounds) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      return { minX, minY, maxX, maxY };
    }
    
    function fitToCanvas() {
      const bounds = calculateBounds();
      const padding = 40;
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      const availableWidth = canvasWidth - padding * 2;
      const availableHeight = canvasHeight - padding * 2;
      const boundsWidth = bounds.maxX - bounds.minX;
      const boundsHeight = bounds.maxY - bounds.minY;
      
      if (boundsWidth === 0 || boundsHeight === 0) {
        scale = 1;
        offsetX = canvasWidth / 2;
        offsetY = canvasHeight / 2;
        return;
      }
      
      const scaleX = availableWidth / boundsWidth;
      const scaleY = availableHeight / boundsHeight;
      scale = Math.min(scaleX, scaleY);
      
      const scaledWidth = boundsWidth * scale;
      const scaledHeight = boundsHeight * scale;
      offsetX = (canvasWidth - scaledWidth) / 2 - bounds.minX * scale;
      offsetY = (canvasHeight - scaledHeight) / 2 - bounds.minY * scale;
    }
    
    function transform(x, y) {
      return {
        x: x * scale + offsetX,
        y: canvas.height - (y * scale + offsetY)
      };
    }
    
    function draw() {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const layerIndex = parseInt(layerSlider.value);
      
      layers.forEach((layer, idx) => {
        if (idx > layerIndex) return;
        
        const isCurrentLayer = idx === layerIndex;
        const opacity = isCurrentLayer ? 1.0 : 0.3;
        
        layer.segments.forEach(seg => {
          if (!seg.extrusion && !showTravel) return;
          
          const start = transform(seg.x1, seg.y1);
          const end = transform(seg.x2, seg.y2);
          
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          
          if (seg.extrusion) {
            ctx.strokeStyle = extrusionColor;
            ctx.lineWidth = 2;
            ctx.globalAlpha = opacity;
          } else {
            ctx.strokeStyle = travelColor;
            ctx.lineWidth = 1;
            ctx.globalAlpha = opacity * 0.7;
          }
          
          ctx.stroke();
        });
      });
      
      ctx.globalAlpha = 1.0;
      
      const currentLayer = layers[layerIndex];
      if (currentLayer) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px sans-serif';
        ctx.fillText('Z: ' + currentLayer.z.toFixed(2) + 'mm', 10, 20);
        ctx.fillText('Layer: ' + (layerIndex + 1) + ' / ' + layers.length, 10, 40);
      }
    }
    
    layerSlider.addEventListener('input', () => {
      const idx = parseInt(layerSlider.value);
      layerInfo.textContent = (idx + 1) + ' / ' + layers.length;
      draw();
    });
    
    travelBtn.addEventListener('click', () => {
      showTravel = !showTravel;
      travelBtn.classList.toggle('active');
      draw();
    });
    
    resetBtn.addEventListener('click', () => {
      fitToCanvas();
      draw();
    });
    
    fitToCanvas();
    draw();
  </script>
</body>
</html>`;
}
