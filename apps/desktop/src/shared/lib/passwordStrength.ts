export type PasswordStrength = "weak" | "fair" | "good" | "strong";

const CLASSES = [/[a-zçğıöşü]/, /[A-ZÇĞİÖŞÜ]/, /\d/, /[^\p{L}\d]/u];

export function passwordScore(value: string): number {
  if (!value) return 0;
  const variety = CLASSES.filter((pattern) => pattern.test(value)).length;
  const unique = new Set(value).size;
  if (value.length < 6 || unique <= 2) return 0;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (variety >= 2) score += 1;
  if (variety >= 3) score += 1;
  if (variety === 4 && unique >= 8) score += 1;
  return score;
}

export function passwordStrength(value: string, breached = false): PasswordStrength {
  if (breached) return "weak";
  const score = passwordScore(value);
  if (score <= 1) return "weak";
  if (score === 2) return "fair";
  if (score <= 4) return "good";
  return "strong";
}
