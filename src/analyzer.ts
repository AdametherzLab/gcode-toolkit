import type { GCodeCommand, PrinterConfig, PrintStats, ValidationIssue, IssueSeverity, AnalysisResult } from "./types.js";

export interface AnalyzerState {
  currentPosition: { x: number; y: number; z: number; e: number };
  absolutePositioning: boolean;
  absoluteExtrusion: boolean;
  currentFeedrate: number;
  currentLayer: number;
  filamentUsed: number;
  printTime: number;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
  commandCounts: {
    movement: number;
    extrusion: number;
    heating: number;
    fan: number;
    other: number;
  };
  issues: ValidationIssue[];
  lastZ: number;
  layers: Set<number>;
}

export class GCodeAnalyzer {
  private state: AnalyzerState;
  private config: PrinterConfig;

  constructor(config: PrinterConfig) {
    this.config = config;
    this.state = this.createInitialState();
  }

  private createInitialState(): AnalyzerState {
    return {
      currentPosition: { x: 0, y: 0, z: 0, e: 0 },
      absolutePositioning: true,
      absoluteExtrusion: true,
      currentFeedrate: this.config.maxFeedrate,
      currentLayer: 0,
      filamentUsed: 0,
      printTime: 0,
      bounds: {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
        minZ: Infinity,
        maxZ: -Infinity,
      },
      commandCounts: {
        movement: 0,
        extrusion: 0,
        heating: 0,
        fan: 0,
        other: 0,
      },
      issues: [],
      lastZ: 0,
      layers: new Set<number>(),
    };
  }

  public analyze(commands: readonly GCodeCommand[]): AnalysisResult {
    this.state = this.createInitialState();

    for (const cmd of commands) {
      this.processCommand(cmd);
    }

    const stats = this.calculateStats();
    return {
      commands,
      stats,
      issues: this.state.issues,
      config: this.config,
    };
  }

  private processCommand(cmd: GCodeCommand): void {
    const { type, code, params } = cmd;

    this.updateCommandCounts(type, code);

    switch (type) {
      case "G":
        this.processGCommand(code, params, cmd.line);
        break;
      case "M":
        this.processMCommand(code, params, cmd.line);
        break;
      case "T":
        this.processTCommand(code, params, cmd.line);
        break;
    }

    this.updateBounds();
    this.detectLayerChange(params);
  }

  private updateCommandCounts(type: string, code: number): void {
    if (type === "G" && (code === 0 || code === 1 || code === 2 || code === 3)) {
      this.state.commandCounts.movement++;
    } else if (type === "G" && (code === 92 || code === 90 || code === 91)) {
      this.state.commandCounts.other++;
    } else if (type === "M" && (code === 104 || code === 109 || code === 140 || code === 190)) {
      this.state.commandCounts.heating++;
    } else if (type === "M" && (code === 106 || code === 107)) {
      this.state.commandCounts.fan++;
    } else if (type === "G" && code === 1 && "E" in this.state.currentPosition) {
      this.state.commandCounts.extrusion++;
    } else {
      this.state.commandCounts.other++;
    }
  }

  private processGCommand(code: number, params: Readonly<Record<string, number>>, line: number): void {
    switch (code) {
      case 0:
      case 1:
        this.processMovement(code, params, line);
        break;
      case 90:
        this.state.absolutePositioning = true;
        break;
      case 91:
        this.state.absolutePositioning = false;
        break;
      case 92:
        this.processSetPosition(params);
        break;
    }
  }

  private processMCommand(code: number, params: Readonly<Record<string, number>>, line: number): void {
    if (code === 82) {
      this.state.absoluteExtrusion = true;
    } else if (code === 83) {
      this.state.absoluteExtrusion = false;
    }
  }

  private processTCommand(code: number, params: Readonly<Record<string, number>>, line: number): void {
    // Tool change - reset extrusion position for new tool
    this.state.currentPosition.e = 0;
  }

  private processMovement(code: number, params: Readonly<Record<string, number>>, line: number): void {
    const target = { ...this.state.currentPosition };
    let hasMovement = false;

    if ("X" in params) {
      target.x = this.state.absolutePositioning ? params.X : this.state.currentPosition.x + params.X;
      hasMovement = true;
    }
    if ("Y" in params) {
      target.y = this.state.absolutePositioning ? params.Y : this.state.currentPosition.y + params.Y;
      hasMovement = true;
    }
    if ("Z" in params) {
      target.z = this.state.absolutePositioning ? params.Z : this.state.currentPosition.z + params.Z;
      hasMovement = true;
    }
    if ("E" in params) {
      const eValue = this.state.absoluteExtrusion ? params.E : this.state.currentPosition.e + params.E;
      const eDelta = eValue - this.state.currentPosition.e;
      if (eDelta > 0) {
        this.state.filamentUsed += eDelta;
      }
      target.e = eValue;
    }

    if ("F" in params) {
      this.state.currentFeedrate = params.F;
    }

    if (hasMovement) {
      const distance = this.calculateDistance(this.state.currentPosition, target);
      const time = distance > 0 ? (distance / this.state.currentFeedrate) * 60 : 0;
      this.state.printTime += time;
    }

    this.state.currentPosition = target;
  }

  private processSetPosition(params: Readonly<Record<string, number>>): void {
    if ("X" in params) this.state.currentPosition.x = params.X;
    if ("Y" in params) this.state.currentPosition.y = params.Y;
    if ("Z" in params) this.state.currentPosition.z = params.Z;
    if ("E" in params) this.state.currentPosition.e = params.E;
  }

  private calculateDistance(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private updateBounds(): void {
    const { x, y, z } = this.state.currentPosition;
    const bounds = this.state.bounds;

    if (x < bounds.minX) bounds.minX = x;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (y > bounds.maxY) bounds.maxY = y;
    if (z < bounds.minZ) bounds.minZ = z;
    if (z > bounds.maxZ) bounds.maxZ = z;
  }

  private detectLayerChange(params: Readonly<Record<string, number>>): void {
    if ("Z" in params) {
      const z = this.state.absolutePositioning ? params.Z : this.state.currentPosition.z + params.Z;
      
      if (Math.abs(z - this.state.lastZ) > 0.01) {
        this.state.layers.add(Math.round(z * 1000) / 1000);
        this.state.lastZ = z;
      }
    }
  }

  private calculateStats(): PrintStats {
    const filamentDiameter = this.config.filamentDiameter;
    const filamentArea = Math.PI * Math.pow(filamentDiameter / 2, 2);
    const filamentVolume = this.state.filamentUsed * filamentArea;

    return {
      estimatedTime: this.state.printTime,
      filamentUsed: this.state.filamentUsed,
      filamentVolume,
      layerCount: this.state.layers.size,
      bounds: {
        minX: this.state.bounds.minX === Infinity ? 0 : this.state.bounds.minX,
        maxX: this.state.bounds.maxX === -Infinity ? 0 : this.state.bounds.maxX,
        minY: this.state.bounds.minY === Infinity ? 0 : this.state.bounds.minY,
        maxY: this.state.bounds.maxY === -Infinity ? 0 : this.state.bounds.maxY,
        minZ: this.state.bounds.minZ === Infinity ? 0 : this.state.bounds.minZ,
        maxZ: this.state.bounds.maxZ === -Infinity ? 0 : this.state.bounds.maxZ,
      },
      commandCounts: this.state.commandCounts,
    };
  }
}