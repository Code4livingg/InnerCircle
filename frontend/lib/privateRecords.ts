interface RecordCandidate {
  value: string;
  synthetic: boolean;
}

export const recordCandidateStrings = (record: unknown): RecordCandidate[] => {
  if (typeof record === "string") {
    return [{ value: record, synthetic: false }];
  }

  if (!record || typeof record !== "object") {
    return [];
  }

  const candidate: RecordCandidate[] = [];
  const obj = record as Record<string, unknown>;

  const directStringKeys = ["plaintext", "recordPlaintext", "record", "value", "ciphertext"];
  for (const key of directStringKeys) {
    if (typeof obj[key] === "string") {
      candidate.push({ value: obj[key], synthetic: false });
    }
  }

  candidate.push({ value: JSON.stringify(record), synthetic: true });
  return candidate;
};

const scoreRecordCandidate = (value: string, fieldLabel: string, fieldLiteral: string): number => {
  let score = 0;
  if (value.includes(fieldLiteral)) score += 2;
  if (value.includes(fieldLabel)) score += 1;
  return score;
};

export const pickRecordForField = (
  records: unknown[],
  fieldLabel: string,
  fieldLiteral: string,
): string => {
  const scored: Array<{ value: string; score: number }> = [];

  for (const record of records) {
    for (const candidate of recordCandidateStrings(record)) {
      const score = scoreRecordCandidate(candidate.value, fieldLabel, fieldLiteral) - (candidate.synthetic ? 2 : 0);
      if (score > 0) {
        scored.push({ value: candidate.value, score });
      }
    }
  }

  if (scored.length === 0) {
    throw new Error("No compatible wallet record found for this content/creator.");
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0].value;
};

export const hasRecordForField = (
  records: unknown[],
  fieldLabel: string,
  fieldLiteral: string,
): boolean => {
  return records.some((record) =>
    recordCandidateStrings(record).some((candidate) => scoreRecordCandidate(candidate.value, fieldLabel, fieldLiteral) > 0),
  );
};
