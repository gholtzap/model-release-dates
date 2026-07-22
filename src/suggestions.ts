import type { IdentifierMatch } from "./data.js";
import type { ModelRelease } from "./types.js";

export const SUGGESTION_REASONS = [
  "exact_identifier",
  "case_insensitive",
  "punctuation_normalized",
  "provider_prefix_removed",
  "close_edit_distance",
  "shared_tokens",
] as const;

export type SuggestionReason = (typeof SUGGESTION_REASONS)[number];

export interface IdentifierSuggestion extends IdentifierMatch {
  readonly score: number;
  readonly reasons: readonly SuggestionReason[];
}

function normalizedIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function withoutPrefix(value: string): string | undefined {
  const match = /^[a-z0-9.-]+[:/](.+)$/i.exec(value);
  return match?.[1];
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(left.split("-").filter(Boolean));
  const rightTokens = new Set(right.split("-").filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  return [...leftTokens].filter((token) => rightTokens.has(token)).length / union.size;
}

interface RankedForm {
  readonly score: number;
  readonly reasons: readonly SuggestionReason[];
}

function rankForm(input: string, candidate: string, prefixRemoved: boolean): RankedForm {
  const prefixReasons: SuggestionReason[] = prefixRemoved ? ["provider_prefix_removed"] : [];
  if (input === candidate) {
    return { score: prefixRemoved ? 0.98 : 1, reasons: [...prefixReasons, "exact_identifier"] };
  }
  if (input.toLowerCase() === candidate.toLowerCase()) {
    return { score: prefixRemoved ? 0.96 : 0.98, reasons: [...prefixReasons, "case_insensitive"] };
  }

  const normalizedInput = normalizedIdentifier(input);
  const normalizedCandidate = normalizedIdentifier(candidate);
  if (normalizedInput === normalizedCandidate) {
    return { score: prefixRemoved ? 0.94 : 0.96, reasons: [...prefixReasons, "punctuation_normalized"] };
  }

  const length = Math.max(normalizedInput.length, normalizedCandidate.length);
  const similarity = 1 - editDistance(normalizedInput, normalizedCandidate) / length;
  const overlap = tokenOverlap(normalizedInput, normalizedCandidate);
  const score = similarity * 0.8 + overlap * 0.2 - (prefixRemoved ? 0.02 : 0);
  return {
    score,
    reasons: [
      ...prefixReasons,
      "close_edit_distance",
      ...(overlap > 0 ? ["shared_tokens" as const] : []),
    ],
  };
}

export function suggestIdentifiers(
  identifier: string,
  models: readonly ModelRelease[],
  options: { readonly namespace?: string; readonly limit?: number } = {},
): readonly IdentifierSuggestion[] {
  const stripped = withoutPrefix(identifier);
  const ranked = models.flatMap((model) =>
    model.identifiers
      .filter((candidate) => options.namespace === undefined || candidate.namespace === options.namespace)
      .map((candidate): IdentifierSuggestion => {
        const forms = [
          rankForm(identifier, candidate.value, false),
          ...(stripped === undefined ? [] : [rankForm(stripped, candidate.value, true)]),
        ];
        const best = forms.sort((left, right) => right.score - left.score)[0]!;
        return {
          matched_identifier: candidate,
          model,
          score: Math.round(best.score * 1000) / 1000,
          reasons: best.reasons,
        };
      }),
  );
  return ranked
    .filter((suggestion) => suggestion.score >= 0.55)
    .sort((left, right) =>
      right.score - left.score ||
      left.matched_identifier.value.localeCompare(right.matched_identifier.value) ||
      left.matched_identifier.namespace.localeCompare(right.matched_identifier.namespace),
    )
    .slice(0, options.limit ?? 5);
}
