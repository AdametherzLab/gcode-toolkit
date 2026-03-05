import { IssueSeverity, type GCodeCommand, type PrinterConfig, type ValidationIssue } from "./types.js";

export interface ValidationOptions {
  /** Maximum allowed retraction distance in millimeters. */
  maxRetractionDistance: number;
  /** Maximum allowed feedrate (speed) in mm/min. */
  maxFeedrate: number;
  /** Minimum first layer height as fraction of nozzle diameter. */
  minFirstLayerHeight: number;
  /** Maximum first layer height as fraction of nozzle diameter. */
  maxFirstLayerHeight: number;
  /** Maximum allowed temperature for hotend in Celsius. */
  maxHotendTemp: number;
  /** Maximum allowed temperature for bed in Celsius. */
  maxBedTemp: number;
  /** Whether to require homing commands (G28) at start. */
  requireHoming: boolean;
  /** Whether to check for rapid moves with extrusion. */
  checkRapidWithExtrusion: boolean;
  /** Whether to validate bed boundaries. */
  checkBedBoundaries: boolean;
}

export const DEFAULT_VALIDATION_OPTIONS: ValidationOptions = {
  maxRetractionDistance: 10,
  maxFeedrate: 3000,
  minFirstLayerHeight: 0.2,
  maxFirstLayerHeight: 0.9,
  maxHotendTemp: 300,
  maxBedTemp: 120,
  requireHoming: true,
  checkRapidWithExtrusion: true,
  checkBedBoundaries: true,
};

export interface ValidationContext {
  currentPosition: {
    x: number;
    y: number;
    z: number;
    e: number;
    f: number;
  };
  isHomed: boolean;
  isExtruding: boolean;
  hotendTemp: number;
  bedTemp: number;
  fanSpeed: number;
  currentLayer: number;
  layerHeight: number;
  retractionCount: number;
  totalRetractionDistance: number;
}

export class GCodeValidator {
  private readonly config: PrinterConfig;
  private readonly options: ValidationOptions;
  private readonly issues: ValidationIssue[] = [];

  constructor(config: PrinterConfig, options: Partial<ValidationOptions> = {}) {
    this.config = config;
    this.options = { ...DEFAULT_VALIDATION_OPTIONS, ...options };
  }

  public validate(commands: readonly GCodeCommand[]): readonly ValidationIssue[] {
    this.issues.length = 0;
    const context = this.createInitialContext();

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      this.validateCommand(cmd, context, i > 0 ? commands[i - 1] : undefined);
      this.updateContext(cmd, context);
    }

    this.performFinalChecks(context);
    return this.issues;
  }

  private createInitialContext(): ValidationContext {
    return {
      currentPosition: { x: 0, y: 0, z: 0, e: 0, f: 0 },
      isHomed: false,
      isExtruding: false,
      hotendTemp: 0,
      bedTemp: 0,
      fanSpeed: 0,
      currentLayer: 0,
      layerHeight: 0,
      retractionCount: 0,
      totalRetractionDistance: 0,
    };
  }

  private validateCommand(
    cmd: GCodeCommand,
    context: ValidationContext,
    prevCmd?: GCodeCommand
  ): void {
    if (this.options.requireHoming && !context.isHomed) {
      if (cmd.type === "G" && cmd.code === 28) {
        context.isHomed = true;
      } else if (cmd.type === "G" && (cmd.code === 0 || cmd.code === 1)) {
        this.addIssue({
          severity: IssueSeverity.Error,
          message: "Movement command before homing (G28)",
          line: cmd.line,
          category: "homing",
        });
      }
    }

    if (this.options.checkRapidWithExtrusion && cmd.type === "G" && cmd.code === 0) {
      if (context.isExtruding) {
        this.addIssue({
          severity: IssueSeverity.Warning,
          message: "Rapid move (G0) while extruding",
          line: cmd.line,
          category: "movement",
        });
      }
    }

    if (cmd.params.F !== undefined) {
      const feedrate = cmd.params.F;
      if (feedrate > this.options.maxFeedrate) {
        this.addIssue({
          severity: IssueSeverity.Warning,
          message: `Feedrate ${feedrate} exceeds maximum ${this.options.maxFeedrate}`,
          line: cmd.line,
          category: "speed",
        });
      }
    }

    if (cmd.type === "M") {
      if (cmd.code === 104 || cmd.code === 109) {
        const temp = cmd.params.S;
        if (temp !== undefined && temp > this.options.maxHotendTemp) {
          this.addIssue({
            severity: IssueSeverity.Error,
            message: `Hotend temperature ${temp} exceeds maximum ${this.options.maxHotendTemp}`,
            line: cmd.line,
            category: "temperature",
          });
        }
      } else if (cmd.code === 140 || cmd.code === 190) {
        const temp = cmd.params.S;
        if (temp !== undefined && temp > this.options.maxBedTemp) {
          this.addIssue({
            severity: IssueSeverity.Error,
            message: `Bed temperature ${temp} exceeds maximum ${this.options.maxBedTemp}`,
            line: cmd.line,
            category: "temperature",
          });
        }
      }
    }

    if (cmd.type === "G" && (cmd.code === 10 || cmd.code === 11)) {
      const eChange = cmd.params.E;
      if (eChange !== undefined && Math.abs(eChange) > this.options.maxRetractionDistance) {
        this.addIssue({
          severity: IssueSeverity.Warning,
          message: `Retraction distance ${Math.abs(eChange)} exceeds maximum ${this.options.maxRetractionDistance}`,
          line: cmd.line,
          category: "retraction",
        });
      }
    }

    if (this.options.checkBedBoundaries && cmd.type === "G" && (cmd.code === 0 || cmd.code === 1)) {
      const x = cmd.params.X ?? context.currentPosition.x;
      const y = cmd.params.Y ?? context.currentPosition.y;
      const [bedWidth, bedDepth] = this.config.bedSize;

      if (x < 0 || x > bedWidth || y < 0 || y > bedDepth) {
        this.addIssue({
          severity: IssueSeverity.Error,
          message: `Move to (${x}, ${y}) exceeds bed boundaries [0-${bedWidth}, 0-${bedDepth}]`,
          line: cmd.line,
          category: "boundaries",
        });
      }
    }

    if (cmd.type === "G" && cmd.code === 1 && cmd.params.Z !== undefined) {
      const z = cmd.params.Z;
      if (context.currentLayer === 0 && z > 0) {
        context.currentLayer = 1;
        context.layerHeight = z;

        const nozzleRatio = z / this.config.nozzleDiameter;
        if (nozzleRatio < this.options.minFirstLayerHeight) {
          this.addIssue({
            severity: IssueSeverity.Warning,
            message: `First layer height ${z}mm (${nozzleRatio.toFixed(2)}× nozzle) is too low`,
            line: cmd.line,
            category: "layer",
          });
        } else if (nozzleRatio > this.options.maxFirstLayerHeight) {
          this.addIssue({
            severity: IssueSeverity.Warning,
            message: `First layer height ${z}mm (${nozzleRatio.toFixed(2)}× nozzle) is too high`,
            line: cmd.line,
            category: "layer",
          });
        }
      }
    }
  }

  private updateContext(cmd: GCodeCommand, context: ValidationContext): void {
    if (cmd.type === "G" && (cmd.code === 0 || cmd.code === 1)) {
      context.currentPosition.x = cmd.params.X ?? context.currentPosition.x;
      context.currentPosition.y = cmd.params.Y ?? context.currentPosition.y;
      context.currentPosition.z = cmd.params.Z ?? context.currentPosition.z;
      context.currentPosition.f = cmd.params.F ?? context.currentPosition.f;

      if (cmd.params.E !== undefined) {
        const eChange = cmd.params.E - context.currentPosition.e;
        context.currentPosition.e = cmd.params.E;
        context.isExtruding = eChange > 0;
      }
    }

    if (cmd.type === "M") {
      if (cmd.code === 104 || cmd.code === 109) {
        context.hotendTemp = cmd.params.S ?? context.hotendTemp;
      } else if (cmd.code === 140 || cmd.code === 190) {
        context.bedTemp = cmd.params.S ?? context.bedTemp;
      } else if (cmd.code === 106) {
        context.fanSpeed = cmd.params.S ?? context.fanSpeed;
      }
    }

    if (cmd.type === "G" && (cmd.code === 10 || cmd.code === 11)) {
      const eChange = cmd.params.E;
      if (eChange !== undefined) {
        context.retractionCount++;
        context.totalRetractionDistance += Math.abs(eChange);
      }
    }
  }

  private performFinalChecks(context: ValidationContext): void {
    if (context.retractionCount > 0) {
      const avgRetraction = context.totalRetractionDistance / context.retractionCount;
      if (avgRetraction > this.options.maxRetractionDistance * 0.8) {
        this.addIssue({
          severity: IssueSeverity.Warning,
          message: `Average retraction distance ${avgRetraction.toFixed(2)}mm is high`,
          line: [1, 1],
          category: "retraction",
        });
      }
    }

    if (context.hotendTemp > 240 && context.fanSpeed < 50) {
      this.addIssue({
        severity: IssueSeverity.Info,
        message: "High temperature print with low fan speed may cause heat creep",
        line: [1, 1],
        category: "cooling",
      });
    }
  }

  private addIssue(issue: Omit<ValidationIssue, "line"> & { line: number | [number, number] }): void {
    this.issues.push({
      severity: issue.severity,
      message: issue.message,
      line: issue.line,
      category: issue.category,
    });
  }
}