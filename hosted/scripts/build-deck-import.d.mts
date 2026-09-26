/** Types for the deck-bundle import SQL generator (plain .mjs, node-only). */
export declare function canonicalJson(value: unknown): string;
export declare function sha256Hex(text: string): string;
export declare function buildImportSql(
  manifestDir?: string,
  options?: { now?: string },
): {
  sql: string;
  imported: { deck: string; version: number; cards: number }[];
  skipped: { deck: string; version: number; status: string; reason: string }[];
};
export declare function main(argv: string[]): number;
