import { describe, it, expect } from "bun:test";
import { parseGCode } from "../src/index.js";
import { extractLayerPaths, generateVisualizerHTML } from "../src/visualizer.js";

describe("extractLayerPaths", () => {
  it("should extract layers from simple multi-layer gcode", () => {
    const { commands } = parseGCode(`
G28
G1 Z0.2 F1000
G1 X10 Y10 E1 F1500
G1 X20 Y10 E2
G1 Z0.4
G1 X10 Y20 E3
G1 X20 Y20 E4
G1 Z0.6
G1 X5 Y5 E5
`);
    const layers = extractLayerPaths(commands);

    expect(layers).toHaveLength(3);
    expect(layers[0].z).toBeCloseTo(0.2);
    expect(layers[1].z).toBeCloseTo(0.4);
    expect(layers[2].z).toBeCloseTo(0.6);
    // Layer 0 has 2 XY segments (X10Y10, X20Y10)
    expect(layers[0].segments).toHaveLength(2);
    // Layer 1 has 2 XY segments
    expect(layers[1].segments).toHaveLength(2);
    // Layer 2 has 1 XY segment
    expect(layers[2].segments).toHaveLength(1);
  });

  it("should mark extrusion vs travel segments", () => {
    const { commands } = parseGCode(`
G1 Z0.2
G1 X10 Y0 F3000
G1 X20 Y0 E1
G1 X30 Y0
`);
    const layers = extractLayerPaths(commands);

    expect(layers).toHaveLength(1);
    const segs = layers[0].segments;
    expect(segs).toHaveLength(3);
    expect(segs[0].extrusion).toBe(false); // travel
    expect(segs[1].extrusion).toBe(true);  // extrusion
    expect(segs[2].extrusion).toBe(false); // travel
  });

  it("should handle relative positioning mode", () => {
    const { commands } = parseGCode(`
G91
G1 Z0.2
G1 X10 Y10 E1
G1 X5 Y5 E1
`);
    const layers = extractLayerPaths(commands);

    expect(layers).toHaveLength(1);
    const segs = layers[0].segments;
    expect(segs).toHaveLength(2);
    // First segment: 0,0 -> 10,10
    expect(segs[0].x1).toBe(0);
    expect(segs[0].y1).toBe(0);
    expect(segs[0].x2).toBe(10);
    expect(segs[0].y2).toBe(10);
    // Second segment: 10,10 -> 15,15
    expect(segs[1].x1).toBe(10);
    expect(segs[1].y1).toBe(10);
    expect(segs[1].x2).toBe(15);
    expect(segs[1].y2).toBe(15);
  });

  it("should record feedrate per segment", () => {
    const { commands } = parseGCode(`
G1 Z0.2
G1 X10 Y0 F1000
G1 X20 Y0 F3000 E1
`);
    const layers = extractLayerPaths(commands);
    const segs = layers[0].segments;

    expect(segs[0].feedrate).toBe(1000);
    expect(segs[1].feedrate).toBe(3000);
  });

  it("should return empty array for gcode with no XY moves", () => {
    const { commands } = parseGCode(`
G28
M104 S200
M140 S60
`);
    const layers = extractLayerPaths(commands);
    expect(layers).toHaveLength(0);
  });

  it("should handle G92 position reset", () => {
    const { commands } = parseGCode(`
G1 Z0.2
G1 X10 Y10 E1
G92 E0
G1 X20 Y20 E1
`);
    const layers = extractLayerPaths(commands);
    expect(layers).toHaveLength(1);
    // Both segments should be extrusions (E went 0->1 then reset to 0, then 0->1)
    expect(layers[0].segments[0].extrusion).toBe(true);
    expect(layers[0].segments[1].extrusion).toBe(true);
  });
});

describe("generateVisualizerHTML", () => {
  it("should generate valid HTML with canvas and controls", () => {
    const { commands } = parseGCode(`
G1 Z0.2
G1 X10 Y10 E1
G1 Z0.4
G1 X20 Y20 E2
`);
    const html = generateVisualizerHTML(commands);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<canvas");
    expect(html).toContain('id="layerSlider"');
    expect(html).toContain('id="travelBtn"');
    expect(html).toContain('id="resetBtn"');
    // Contains embedded layer data
    expect(html).toContain('"segments"');
  });

  it("should apply custom options", () => {
    const { commands } = parseGCode("G1 Z0.2\nG1 X10 Y10 E1");
    const html = generateVisualizerHTML(commands, {
      width: 1024,
      height: 768,
      title: "My Print",
      backgroundColor: "#000",
      extrusionColor: "#ff0000",
    });

    expect(html).toContain('width="1024"');
    expect(html).toContain('height="768"');
    expect(html).toContain("<title>My Print</title>");
    expect(html).toContain("#000");
    expect(html).toContain("#ff0000");
  });

  it("should escape HTML in title", () => {
    const { commands } = parseGCode("G1 Z0.2\nG1 X5 Y5 E1");
    const html = generateVisualizerHTML(commands, {
      title: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("should handle empty commands gracefully", () => {
    const html = generateVisualizerHTML([]);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("No layers found");
  });
});
