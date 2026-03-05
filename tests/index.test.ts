import { describe, it, expect, beforeEach } from "bun:test";
import {
  parseGCode,
  detectLayers,
  extractMovementParams,
  normalizeCommand,
  isMovementCommand,
  isExtrusionCommand,
  isHeatingCommand,
  isFanCommand,
  GCodeAnalyzer,
  GCodeValidator,
  DEFAULT_VALIDATION_OPTIONS,
  type GCodeCommand,
  type PrinterConfig,
  type ParseOptions,
  type IssueSeverity,
} from "../src/index.js";

describe("GCode Parser", () => {
  it("should parse basic G-code commands", () => {
    const content = `
G1 X10 Y20 F3000 ; move to position
M104 S200 ; set hotend temperature
G28 ; home all axes
`;
    const result = parseGCode(content);

    expect(result.commands).toHaveLength(3);
    expect(result.commands[0]).toMatchObject({
      type: "G",
      code: 1,
      params: { X: 10, Y: 20, F: 3000 },
      comment: "move to position",
    });
    expect(result.commands[1]).toMatchObject({
      type: "M",
      code: 104,
      params: { S: 200 },
      comment: "set hotend temperature",
    });
    expect(result.commands[2]).toMatchObject({
      type: "G",
      code: 28,
      params: {},
      comment: "home all axes",
    });
  });

  it("should handle empty lines and comments only", () => {
    const content = `
; Start of print

; Layer 1
G1 X0 Y0

; End of print
`;
    const result = parseGCode(content, { includeComments: false });

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].type).toBe("G");
    expect(result.commands[0].code).toBe(1);
  });

  it("should update parser state with coordinates", () => {
    const content = `
G1 X10 Y20 Z0.2
G1 X30
G91
G1 X5
`;
    const result = parseGCode(content);

    expect(result.state.x).toBe(35);
    expect(result.state.y).toBe(20);
    expect(result.state.z).toBe(0.2);
    expect(result.state.absolutePosition).toBe(false);
  });

  it("should detect layer changes from Z movements", () => {
    const content = `
G1 Z0.2
G1 X10 Y10
G1 Z0.4
G1 X20 Y20
G1 Z0.4 ; same Z, no new layer
G1 Z0.6
`;
    const result = parseGCode(content);
    const layers = detectLayers(result.commands);

    expect(layers).toEqual([2, 4, 7]);
  });

  it("should normalize command strings", () => {
    expect(normalizeCommand("g1 x10 y20  ")).toBe("G1 X10 Y20");
    expect(normalizeCommand("  M104  S200  ")).toBe("M104 S200");
    expect(normalizeCommand("G28; home")).toBe("G28; HOME");
  });
});

describe("Command Type Detection", () => {
  const createCommand = (type: string, code: number, params: Record<string, number> = {}): GCodeCommand => ({
    line: 1,
    raw: "",
    type,
    code,
    params,
    comment: undefined,
  });

  it("should identify movement commands", () => {
    expect(isMovementCommand(createCommand("G", 0))).toBe(true);
    expect(isMovementCommand(createCommand("G", 1))).toBe(true);
    expect(isMovementCommand(createCommand("G", 2))).toBe(true);
    expect(isMovementCommand(createCommand("G", 3))).toBe(true);
    expect(isMovementCommand(createCommand("M", 104))).toBe(false);
  });

  it("should identify extrusion commands", () => {
    expect(isExtrusionCommand(createCommand("G", 1, { E: 5 }))).toBe(true);
    expect(isExtrusionCommand(createCommand("G", 1, { E: 0 }))).toBe(false);
    expect(isExtrusionCommand(createCommand("G", 0, { E: 5 }))).toBe(true);
  });

  it("should identify heating commands", () => {
    expect(isHeatingCommand(createCommand("M", 104))).toBe(true);
    expect(isHeatingCommand(createCommand("M", 109))).toBe(true);
    expect(isHeatingCommand(createCommand("M", 140))).toBe(true);
    expect(isHeatingCommand(createCommand("M", 190))).toBe(true);
    expect(isHeatingCommand(createCommand("G", 1))).toBe(false);
  });

  it("should identify fan commands", () => {
    expect(isFanCommand(createCommand("M", 106))).toBe(true);
    expect(isFanCommand(createCommand("M", 107))).toBe(false);
    expect(isFanCommand(createCommand("G", 1))).toBe(false);
  });

  it("should extract movement parameters", () => {
    const cmd = createCommand("G", 1, { X: 10, Y: 20, Z: 0.2, E: 5, F: 3000 });
    const params = extractMovementParams(cmd);

    expect(params).toEqual({
      x: 10,
      y: 20,
      z: 0.2,
      e: 5,
      f: 3000,
    });
  });
});

describe("GCodeAnalyzer", () => {
  const config: PrinterConfig = {
    nozzleDiameter: 0.4,
    filamentDiameter: 1.75,
    maxFeedrate: 3000,
    bedSize: [220, 220],
    maxHeight: 250,
  };

  let analyzer: GCodeAnalyzer;

  beforeEach(() => {
    analyzer = new GCodeAnalyzer(config);
  });

  it("should calculate basic print statistics", () => {
    const commands = parseGCode(`
G1 X10 Y10 Z0.2 F3000
G1 X20 Y20 E5
G1 Z0.4
G1 X30 Y30 E10
`).commands;

    const result = analyzer.analyze(commands);

    expect(result.stats.filamentUsed).toBe(10);
    expect(result.stats.layerCount).toBe(2);
    expect(result.stats.bounds.minX).toBe(10);
    expect(result.stats.bounds.maxX).toBe(30);
    expect(result.stats.commandCounts.movement).toBe(4);
    expect(result.stats.commandCounts.extrusion).toBe(2);
  });

  it("should handle relative positioning mode", () => {
    const commands = parseGCode(`
G91
G1 X10 Y10 E5
G1 X10 Y10 E5
`).commands;

    const result = analyzer.analyze(commands);

    expect(result.stats.filamentUsed).toBe(5);
    expect(result.stats.bounds.maxX).toBe(20);
    expect(result.stats.bounds.maxY).toBe(20);
  });

  it("should calculate filament volume correctly", () => {
    const commands = parseGCode(`
G1 E100
`).commands;

    const result = analyzer.analyze(commands);
    const expectedArea = Math.PI * Math.pow(config.filamentDiameter / 2, 2);
    const expectedVolume = 100 * expectedArea;

    expect(result.stats.filamentVolume).toBeCloseTo(expectedVolume, 5);
  });
});

describe("GCodeValidator", () => {
  const config: PrinterConfig = {
    nozzleDiameter: 0.4,
    filamentDiameter: 1.75,
    maxFeedrate: 3000,
    bedSize: [220, 220],
    maxHeight: 250,
  };

  it("should detect missing homing command", () => {
    const validator = new GCodeValidator(config, { requireHoming: true });
    const commands = parseGCode(`
G1 X10 Y10
G28
G1 X20 Y20
`).commands;

    const issues = validator.validate(commands);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error' as IssueSeverity);
    expect(issues[0].message).toContain("Movement command before homing");
  });

  it("should detect bed boundary violations", () => {
    const validator = new GCodeValidator(config, { checkBedBoundaries: true });
    const commands = parseGCode(`
G28
G1 X250 Y250 ; outside bed
G1 X100 Y100 ; inside bed
`).commands;

    const issues = validator.validate(commands);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error' as IssueSeverity);
    expect(issues[0].message).toContain("exceeds bed boundaries");
  });

  it("should validate temperature limits", () => {
    const validator = new GCodeValidator(config, {
      maxHotendTemp: 250,
      maxBedTemp: 100,
    });
    const commands = parseGCode(`
M104 S300 ; too hot
M140 S150 ; too hot
M104 S200 ; ok
`).commands;

    const issues = validator.validate(commands);

    expect(issues).toHaveLength(2);
    expect(issues[0].severity).toBe('error' as IssueSeverity);
    expect(issues[0].message).toContain("Hotend temperature");
    expect(issues[1].severity).toBe('error' as IssueSeverity);
    expect(issues[1].message).toContain("Bed temperature");
  });

  it("should use default validation options", () => {
    const validator = new GCodeValidator(config);
    expect(validator).toBeDefined();
    expect(DEFAULT_VALIDATION_OPTIONS.maxFeedrate).toBe(3000);
    expect(DEFAULT_VALIDATION_OPTIONS.maxRetractionDistance).toBe(10);
  });
});