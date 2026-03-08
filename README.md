# 🛠️ G-code Toolkit

**Parse, analyze, validate, and visualize G-code files for 3D printers and CNC machines.**

Ever wondered what's *really* inside that G-code file? This zero-dependency TypeScript toolkit slices and dices your G-code, giving you print stats, layer-by-layer analysis, automatic issue detection, and an interactive browser-based visualizer. Perfect for building printer dashboards, slicer plugins, or just satisfying your curiosity.

## 📦 Installation

bash
# Using Bun (recommended)
bun add gcode-toolkit

# Using npm
npm install gcode-toolkit

# Using yarn
yarn add gcode-toolkit


## 🚀 Quick Start


import {
  parseGCode,
  GCodeAnalyzer,
  GCodeValidator,
  extractLayerPaths,
  generateVisualizerHTML,
} from 'gcode-toolkit';

// Parse a G-code file
const gcode = `G28 ; Home
G1 Z0.2 F1000
G1 X10 Y10 E5 F1500 ; Move and extrude
M104 S200 ; Set hotend temperature`;

const { commands } = parseGCode(gcode);

// Analyze for statistics
const analyzer = new GCodeAnalyzer({
  nozzleDiameter: 0.4,
  filamentDiameter: 1.75,
  maxFeedrate: 3000,
  bedSize: [220, 220],
  maxHeight: 250,
});
const result = analyzer.analyze(commands);
console.log(`Layers: ${result.stats.layerCount}`);
console.log(`Filament used: ${result.stats.filamentUsed.toFixed(1)}mm`);

// Validate for issues
const validator = new GCodeValidator({
  nozzleDiameter: 0.4,
  filamentDiameter: 1.75,
  maxFeedrate: 3000,
  bedSize: [220, 220],
  maxHeight: 250,
});
const issues = validator.validate(commands);
console.log(`Issues found: ${issues.length}`);


## 🔍 Interactive G-code Visualizer

Generate a self-contained HTML page that lets you visually inspect toolpaths layer by layer:


import { parseGCode, generateVisualizerHTML } from 'gcode-toolkit';
import { writeFileSync } from 'fs';

const gcode = readFileSync('my-print.gcode', 'utf-8');
const { commands } = parseGCode(gcode);

// Generate interactive visualizer
const html = generateVisualizerHTML(commands, {
  title: 'My Print Visualization',
  width: 1024,
  height: 768,
});

writeFileSync('visualizer.html', html);
// Open visualizer.html in any browser


### Visualizer Features

- **Layer-by-layer slider** — step through each layer to inspect the toolpath
- **Pan & zoom** — drag to pan, scroll to zoom into details
- **Travel toggle** — show/hide non-extrusion travel moves
- **Color-coded paths** — extrusion moves in green, travel in gray
- **Layer stats** — segment count, extrusion count, travel count per layer
- **Self-contained** — single HTML file with inline CSS/JS, no dependencies

### Extracting Layer Data Programmatically


import { parseGCode, extractLayerPaths } from 'gcode-toolkit';

const { commands } = parseGCode(gcode);
const layers = extractLayerPaths(commands);

for (const layer of layers) {
  const extSegments = layer.segments.filter(s => s.extrusion);
  console.log(`Layer ${layer.index} (Z=${layer.z}mm): ${extSegments.length} extrusion segments`);
}


### Visualizer Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `width` | `number` | `800` | Canvas width in pixels |
| `height` | `number` | `600` | Canvas height in pixels |
| `backgroundColor` | `string` | `"#1a1a2e"` | Background color |
| `travelColor` | `string` | `"rgba(100,100,100,0.3)"` | Travel move color |
| `extrusionColor` | `string` | `"#00D26A"` | Extrusion move color |
| `showTravel` | `boolean` | `true` | Show travel moves |
| `title` | `string` | `"G-code Visualizer"` | Page title |

## 📐 API Reference

### `parseGCode(content, options?)`

Parses raw G-code text into structured commands.

### `detectLayers(commands)`

Returns line numbers where layer changes occur.

### `extractLayerPaths(commands)`

Extracts layer-by-layer toolpath segments with position, extrusion, and feedrate data.

### `generateVisualizerHTML(commands, options?)`

Generates a self-contained interactive HTML visualizer page.

### `GCodeAnalyzer`

Analyzes commands for print statistics (time, filament, bounds, layer count).

### `GCodeValidator`

Validates commands against printer limits and best practices.

### Utility Functions

- `normalizeCommand(raw)` — uppercase and trim
- `isMovementCommand(cmd)` — G0/G1/G2/G3
- `isExtrusionCommand(cmd)` — movement with positive E
- `isHeatingCommand(cmd)` — M104/M109/M140/M190
- `isFanCommand(cmd)` — M106
- `extractMovementParams(cmd)` — extract X/Y/Z/E/F

## 🧪 Testing

bash
bun test


## 📄 License

MIT
