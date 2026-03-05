import type * as fs from "fs";

/**
 * Represents a single parsed G-code command.
 */
export interface GCodeCommand {
  /** Original line number (1-indexed) from the source file. */
  readonly line: number;
  /** The raw command string, trimmed. */
  readonly raw: string;
  /** The primary command letter (e.g., 'G', 'M', 'T'). */
  readonly type: string;
  /** The numeric code following the command letter (e.g., 0, 1, 104). */
  readonly code: number;
  /** Key-value pairs of parameters (e.g., { X: 10.5, F: 300 }). */
  readonly params: Readonly<Record<string, number>>;
  /** Optional comment extracted from the line. */
  readonly comment?: string;
}

/**
 * Basic printer configuration used for analysis and calculations.
 */
export interface PrinterConfig {
  /** Nozzle diameter in millimeters. */
  readonly nozzleDiameter: number;
  /** Filament diameter in millimeters. */
  readonly filamentDiameter: number;
  /** Maximum feedrate (speed) in mm/min. */
  readonly maxFeedrate: number;
  /** Heated bed dimensions [width, depth] in millimeters. */
  readonly bedSize: [number, number];
  /** Maximum print height (Z) in millimeters. */
  readonly maxHeight: number;
}

/**
 * Aggregated statistics for a G-code file.
 */
export interface PrintStats {
  /** Estimated total print time in minutes. */
  readonly estimatedTime: number;
  /** Total length of filament used in millimeters. */
  readonly filamentUsed: number;
  /** Total volume of filament used in cubic millimeters. */
  readonly filamentVolume: number;
  /** Number of distinct layers detected. */
  readonly layerCount: number;
  /** Minimum and maximum X, Y, Z coordinates encountered. */
  readonly bounds: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
    readonly minZ: number;
    readonly maxZ: number;
  };
  /** Counts of major command types. */
  readonly commandCounts: {
    readonly movement: number;
    readonly extrusion: number;
    readonly heating: number;
    readonly fan: number;
    readonly other: number;
  };
}

/**
 * Severity levels for validation issues.
 */
export enum IssueSeverity {
  Info = "info",
  Warning = "warning",
  Error = "error"
}

/**
 * A detected issue or anomaly in the G-code.
 */
export interface ValidationIssue {
  /** The severity of the issue. */
  readonly severity: IssueSeverity;
  /** A descriptive message. */
  readonly message: string;
  /** The line number(s) where the issue occurs. */
  readonly line: number | [number, number];
  /** Optional category for grouping issues. */
  readonly category?: string;
}

/**
 * Options for parsing a G-code file.
 */
export interface ParseOptions {
  /** Whether to include comments in parsed commands. Default: true. */
  readonly includeComments?: boolean;
  /** Custom handler for parsing errors (e.g., malformed numbers). */
  readonly onParseError?: (error: Error, line: number, raw: string) => void;
}

/**
 * Options for analyzing a G-code file.
 */
export interface AnalyzeOptions {
  /** Printer configuration for accurate calculations. */
  readonly config: PrinterConfig;
  /** Whether to perform validation checks. Default: true. */
  readonly validate?: boolean;
  /** Custom issue filter or handler. */
  readonly onIssue?: (issue: ValidationIssue) => void;
}

/**
 * Result of a full G-code file analysis.
 */
export interface AnalysisResult {
  /** The parsed commands. */
  readonly commands: readonly GCodeCommand[];
  /** Calculated print statistics. */
  readonly stats: PrintStats;
  /** Detected validation issues. */
  readonly issues: readonly ValidationIssue[];
  /** The printer configuration used. */
  readonly config: PrinterConfig;
}

/**
 * A lightweight representation of a G-code file reference.
 */
export interface GCodeFile {
  /** File system path. */
  readonly path: string;
  /** File size in bytes. */
  readonly size: number;
  /** File modification time. */
  readonly mtime: Date;
  /** Optional file handle for streaming. */
  readonly handle?: fs.promises.FileHandle;
}