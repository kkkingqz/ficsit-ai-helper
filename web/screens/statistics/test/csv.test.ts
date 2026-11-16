import { describe, expect, it } from "vitest";
import {
  buildCsvRow,
  escapeCsvCell,
  generateStatisticsCsv,
  triggerBrowserCsvDownload,
  type StatisticsExportData,
} from "../src/csv.js";

describe("Statistics CSV Export (RFC 4180)", () => {
  it("escapes special characters correctly per RFC 4180", () => {
    // Normal values
    expect(escapeCsvCell("simple")).toBe("simple");
    expect(escapeCsvCell(123)).toBe("123");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");

    // Commas
    expect(escapeCsvCell("hello,world")).toBe('"hello,world"');

    // Quotes
    expect(escapeCsvCell('say "hello"')).toBe('"say ""hello"""');

    // Newlines
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("line1\r\nline2")).toBe('"line1\r\nline2"');

    // Object with reading or value
    expect(escapeCsvCell({ value: 500 })).toBe("500");
    expect(escapeCsvCell({ reading: { value: 750 } })).toBe("750");
  });

  it("builds CRLF terminated rows", () => {
    const row = buildCsvRow(["A", "B,C", 'D"E']);
    expect(row).toBe('A,"B,C","D""E"\r\n');
  });

  it("generates full statistics CSV export with metadata, tables, and charts", () => {
    const data: StatisticsExportData = {
      tab: "energy",
      window: 15,
      sessionTimeSec: 2100,
      tables: [
        {
          title: "Generators by type",
          columns: ["Generator", "State", "Output (MW)"],
          rows: [
            ["Coal", "3 / 4 running", 225],
            ["Fuel", "4 / 4 running", 600],
          ],
        },
      ],
      charts: [
        {
          title: "Power",
          series: [
            {
              id: "power.production",
              label: "Generation",
              timestamps: [2000, 2010, 2020],
              values: [825, 830, 820],
            },
            {
              id: "power.consumption",
              label: "Consumption",
              timestamps: [2000, 2010, 2020],
              values: [550, 560, 570],
            },
          ],
        },
      ],
    };

    const csv = generateStatisticsCsv(data);

    // Verify metadata
    expect(csv).toContain("# Report,ENERGY\r\n");
    expect(csv).toContain("# Window,15 min\r\n");
    expect(csv).toContain("# Session Time,2100 s\r\n");

    // Verify table section
    expect(csv).toContain("[TABLE: Generators by type]\r\n");
    expect(csv).toContain("Generator,State,Output (MW)\r\n");
    expect(csv).toContain("Coal,3 / 4 running,225\r\n");

    // Verify chart section
    expect(csv).toContain("[CHART: Power]\r\n");
    expect(csv).toContain("Timestamp (s),Generation,Consumption\r\n");
    expect(csv).toContain("2000,825,550\r\n");
    expect(csv).toContain("2010,830,560\r\n");
    expect(csv).toContain("2020,820,570\r\n");
  });

  it("safely handles browser download trigger in non-DOM environment", () => {
    // In Node.js / non-browser, returns false without crashing
    const res = triggerBrowserCsvDownload("a,b\r\n", "test.csv");
    expect(res).toBe(false);
  });
});
