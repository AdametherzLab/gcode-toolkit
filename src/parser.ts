import * as path from "path";
import type { GCodeCommand, ParseOptions, ValidationIssue } from "./types";

export interface ParserState {
  x: number;
  y: number;
  z: number;
  e: number;
  f: number;
  absoluteExtrusion: boolean;
  absolutePosition: boolean;
  units: "mm" | "inch";
  currentLayer: number;
  lastZ: number;
}

export interface ParseResult {
  readonly commands: readonly GCodeCommand[];
  readonly state: ParserState;
  readonly issues: readonly ValidationIssue[];
}

export function parseGCode(
  content: string,
  options: ParseOptions = {}
): ParseResult {
  const lines = content.split("\n");
  const commands: GCodeCommand[] = [];
  const issues: ValidationIssue[] = [];

  const state: ParserState = {
    x: 0,
    y: 0,
    z: 0,
    e: 0,
    f: 0,
    absoluteExtrusion: true,
    absolutePosition: true,
    units: "mm",
    currentLayer: 0,
    lastZ: 0,
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const rawLine = lines[i].trim();
    if (rawLine.length === 0) continue;

    const commentMatch = rawLine.match(/;(.*)$/);
    const comment = commentMatch ? commentMatch[1].trim() : undefined;
    const codePart = commentMatch ? rawLine.substring(0, commentMatch.index).trim() : rawLine;

    if (codePart.length === 0) {
      if (options.includeComments !== false && comment) {
        commands.push({
          line: lineNumber,
          raw: rawLine,
          type: "",
          code: 0,
          params: {},
          comment,
        });
      }
      continue;
    }

    const commandMatch = codePart.match(/^([GMT])(\d+(?:\.\d+)?)/i);
    if (!commandMatch) {
      if (options.onParseError) {
        options.onParseError(new Error("Invalid command format"), lineNumber, rawLine);
      }
      continue;
    }

    const type = commandMatch[1].toUpperCase();
    const code = parseFloat(commandMatch[2]);
    const params: Record<string, number> = {};

    const paramRegex = /([XYZEFSPIJRQ])(-?\d+(?:\.\d+)?)/gi;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(codePart)) !== null) {
      const key = paramMatch[1].toUpperCase();
      const value = parseFloat(paramMatch[2]);
      if (isNaN(value)) {
        if (options.onParseError) {
          options.onParseError(new Error(`Invalid number: ${paramMatch[2]}`), lineNumber, rawLine);
        }
        continue;
      }
      params[key] = value;
    }

    updateParserState(state, type, code, params);

    commands.push({
      line: lineNumber,
      raw: rawLine,
      type,
      code,
      params,
      comment,
    });
  }

  return {
    commands,
    state,
    issues,
  };
}

function updateParserState(
  state: ParserState,
  type: string,
  code: number,
  params: Record<string, number>
): void {
  if (type === "G") {
    if (code === 90) {
      state.absolutePosition = true;
      state.absoluteExtrusion = true;
    } else if (code === 91) {
      state.absolutePosition = false;
      state.absoluteExtrusion = false;
    } else if (code === 20) {
      state.units = "inch";
    } else if (code === 21) {
      state.units = "mm";
    }
  }

  if (params.X !== undefined) {
    state.x = state.absolutePosition ? params.X : state.x + params.X;
  }
  if (params.Y !== undefined) {
    state.y = state.absolutePosition ? params.Y : state.y + params.Y;
  }
  if (params.Z !== undefined) {
    const newZ = state.absolutePosition ? params.Z : state.z + params.Z;
    if (Math.abs(newZ - state.lastZ) > 0.01) {
      state.currentLayer++;
      state.lastZ = newZ;
    }
    state.z = newZ;
  }
  if (params.E !== undefined) {
    state.e = state.absoluteExtrusion ? params.E : state.e + params.E;
  }
  if (params.F !== undefined) {
    state.f = params.F;
  }
}

export function detectLayers(commands: readonly GCodeCommand[]): number[] {
  const layerStarts: number[] = [];
  let lastZ = -Infinity;
  let currentLayer = 0;

  for (const cmd of commands) {
    if (cmd.type === "G" && (cmd.code === 0 || cmd.code === 1)) {
      const z = cmd.params.Z;
      if (z !== undefined && Math.abs(z - lastZ) > 0.01) {
        layerStarts.push(cmd.line);
        lastZ = z;
        currentLayer++;
      }
    }
  }

  return layerStarts;
}

export function extractMovementParams(command: GCodeCommand): {
  x?: number;
  y?: number;
  z?: number;
  e?: number;
  f?: number;
} {
  return {
    x: command.params.X,
    y: command.params.Y,
    z: command.params.Z,
    e: command.params.E,
    f: command.params.F,
  };
}

export function normalizeCommand(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, " ").trim();
}

export function isMovementCommand(command: GCodeCommand): boolean {
  return command.type === "G" && (command.code === 0 || command.code === 1 || command.code === 2 || command.code === 3);
}

export function isExtrusionCommand(command: GCodeCommand): boolean {
  return isMovementCommand(command) && command.params.E !== undefined && command.params.E > 0;
}

export function isHeatingCommand(command: GCodeCommand): boolean {
  return (command.type === "M" && (command.code === 104 || command.code === 109 || command.code === 140 || command.code === 190));
}

export function isFanCommand(command: GCodeCommand): boolean {
  return command.type === "M" && command.code === 106;
}