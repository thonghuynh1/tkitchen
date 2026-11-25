export interface AvoidedTerm {
  readonly term: string;
  readonly phrase: string;
  readonly words: readonly string[];
}

export function avoidedTerms(text: string): AvoidedTerm[];
export function identifierWords(name: string): string[];
export function avoidedIn(name: string, terms: readonly AvoidedTerm[]): AvoidedTerm | undefined;

declare const plugin: unknown;
export default plugin;
