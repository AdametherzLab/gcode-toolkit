# 🛠️ G-code Toolkit

**Parse, analyze, and validate G-code files for 3D printers and CNC machines.**

Ever wondered what's *really* inside that G-code file? This zero-dependency TypeScript toolkit slices and dices your G-code, giving you print stats, layer-by-layer analysis, and automatic issue detection. Perfect for building printer dashboards, slicer plugins, or just satisfying your curiosity.

## 📦 Installation

```bash
# Using Bun (recommended)
bun add gcode-toolkit

# Using npm
npm install gcode-toolkit

# Using yarn
yarn add gcode-toolkit
```

## 🚀 Quick Start

```typescript
// REMOVED external import: import { parseGCode, GCodeAnalyzer, GCodeValidator } from 'gcode-toolkit';

// Parse a G-code file
const gcode = `G28 ; Home
G1 X10 Y10 E5 ; Move and extrude
M104 S200 ; Set hotend temperature`;

const commands = parseGCode(gcode);

// Analyze for statistics
const analyzer = new GCodeAnalyzer();
const result = analyzer.analyze(commands);

console.log(`Print time: ${result.stats.printTimeMinutes.toFixed(1)} minutes`);
console.log(`Filament used: ${result.stats.filamentUsedMm.toFixed(1)}mm`);
console.log(`Layer count: ${result.stats.layerCount}`);

// Validate for common issues
const validator = new GCodeValidator();
const issues = validator.validate(commands);

issues.forEach(issue => {
  console.log(`${issue.severity}: ${issue.message} at line ${issue.line}`);
});
```

## 📖 API Reference

### Core Functions

#### `parseGCode(gcode: string, options?: ParseOptions): GCodeCommand[]`
Parses raw G-code text into structured command objects. Handles comments, line numbers, and parameter extraction.

```typescript
const commands = parseGCode("G1 X100 Y100 F3000");
// Returns: [{ type: 'G', code: 1, params: { X: 100, Y: 100, F: 3000 }, raw: 'G1 X100 Y100 F3000', line: 1 }]
```

#### `detectLayers(commands: readonly GCodeCommand[]): number[]`
Identifies layer change commands (typically `;LAYER:` comments) and returns their line numbers.

#### `extractMovementParams(command: GCodeCommand): MovementParams | null`
Extracts movement parameters (X, Y, Z, E, F) from movement commands (G0, G1, G2, G3).

#### `normalizeCommand(raw: string): string`
### Utility Predicates

- `isMovementCommand(command)` - True for G0, G1, G2, G3
- `isExtrusionCommand(command)` - True when E parameter changes
- `isHeatingCommand(command)` - True for M104, M109, M140, M190
- `isFanCommand(command)` - True for M106, M107

### GCodeAnalyzer Class

The main analysis engine. Create an instance, feed it commands, and get detailed statistics.

```typescript
const analyzer = new GCodeAnalyzer({
  nozzleDiameter: 0.4,
  filamentDiameter: 1.75,
  // Optional printer configuration
});

const result = analyzer.analyze(commands, {
  detectLayers: true,
  calculateVolume: true,
});

// result contains:
// - stats: PrintStats (time, filament, layers, etc.)
// - layers: Layer[] if detected
// - issues: ValidationIssue[] if any found
```

### GCodeValidator Class

Validates G-code for common issues and potential problems.

```typescript
const validator = new GCodeValidator({
  maxFeedrate: 150,      // mm/s
  maxTemperature: 300,   // °C
  requireHeating: true,
  // ... other options
});

const issues = validator.validate(commands);

// Each issue has:
// - severity: IssueSeverity (INFO, WARNING, ERROR)
// - message: string
// - line: number
// - suggestion?: string
```

## 🧪 Examples

### Example 1: Basic File Analysis

```typescript
import { readFileSync } from 'fs';
// REMOVED external import: import { parseGCode, GCodeAnalyzer } from 'gcode-toolkit';

const fileContent = readFileSync('print.gcode', 'utf-8');
const commands = parseGCode(fileContent);

const analyzer = new GCodeAnalyzer();
const analysis = analyzer.analyze(commands);

console.log('=== Print Analysis ===');
console.log(`Total commands: ${analysis.stats.totalCommands}`);
console.log(`Print time: ${analysis.stats.printTimeMinutes} min`);
console.log(`Filament used: ${analysis.stats.filamentUsedMm.toFixed(2)}mm`);
console.log(`Filament volume: ${analysis.stats.filamentVolumeCm3.toFixed(2)}cm³`);
console.log(`Max temp: ${analysis.stats.maxTemperature}°C`);
console.log(`Layers: ${analysis.stats.layerCount}`);
```

### Example 2: Custom Validation Rules

```typescript
// REMOVED external import: import { GCodeValidator, IssueSeverity } from 'gcode-toolkit';

const validator = new GCodeValidator({
  maxFeedrate: 120,
  maxTemperature: 250,
  requireBedLeveling: true,
  requireFanStart: true,
  minLayerHeight: 0.1,
  maxLayerHeight: 0.3,
});

const issues = validator.validate(commands);

// Filter for critical issues
const criticalIssues = issues.filter(
  issue => issue.severity === IssueSeverity.ERROR
);

if (criticalIssues.length > 0) {
  console.warn('⚠️ Critical issues found:');
  criticalIssues.forEach(issue => {
    console.warn(`Line ${issue.line}: ${issue.message}`);
  });
}
```

### Example 3: Layer-by-Layer Analysis

```typescript
// REMOVED external import: import { detectLayers, parseGCode } from 'gcode-toolkit';

const commands = parseGCode(gcodeContent);
const layerLines = detectLayers(commands);

console.log(`Found ${layerLines.length} layers:`);
layerLines.forEach((lineNumber, index) => {
  console.log(`Layer ${index}: starts at line ${lineNumber}`);
});

// Extract commands for a specific layer
const layerIndex = 5;
const startLine = layerLines[layerIndex];
const endLine = layerLines[layerIndex + 1] || commands.length;
const layerCommands = commands.slice(startLine - 1, endLine - 1);
```

## 🤝 Contributing

Found a bug? Have a feature idea? We'd love your help!

1. Fork the repository
2. Create a feature branch (`git checkout -b cool-new-feature`)
3. Make your changes
4. Run tests (`bun test`)
5. Submit a pull request

Check out the [GitHub Issues](https://github.com/AdametherzLab/gcode-toolkit/issues) for ideas on where to start. All contributions are welcome!

## 📄 License

MIT © AdametherzLab

---

**Ready to slice?** Start analyzing your G-code today! Whether you're building the next great printer interface or just geeking out over extrusion math, this toolkit has you covered. 🎯