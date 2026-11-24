export const MAX_MODULE_LINES: number;
export function lineCount(text: string): number;
export function importSpecifiers(text: string): string[];
export function inspect(files: Record<string, string>): string[];
export function checkModuleStructure(root: string): { errors: string[]; count: number };
