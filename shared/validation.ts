// Input rules shared by the browser (forms) and the server (Cognito pre-sign-up Lambda).
// Each validator returns an error message, or null when the value is valid.

export const GENDER_OPTIONS = ['Female', 'Male', 'Non-binary', 'Prefer not to say'] as const;
export type Gender = (typeof GENDER_OPTIONS)[number];

export const NAME_MAX_LENGTH = 100;
export const PASSWORD_MIN_LENGTH = 8;

// Gmail local parts use letters, digits and dots; no leading, trailing or repeated dots.
const GMAIL_PATTERN = /^[a-z0-9]+(?:\.[a-z0-9]+)*@gmail\.com$/;
const GMAIL_LOCAL_MAX_LENGTH = 64;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): string | null {
  const value = normalizeEmail(email);
  if (!value) return 'Email is required.';
  if (!value.endsWith('@gmail.com')) return 'Only @gmail.com addresses are allowed.';
  if (value.includes('+')) return 'Gmail addresses containing "+" are not allowed.';
  const localPart = value.slice(0, -'@gmail.com'.length);
  if (!GMAIL_PATTERN.test(value) || localPart.length > GMAIL_LOCAL_MAX_LENGTH) {
    return 'Enter a valid Gmail address.';
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Password is required.';
  const missing: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH)
    missing.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
  if (!/[A-Z]/.test(password)) missing.push('an uppercase letter');
  if (!/[a-z]/.test(password)) missing.push('a lowercase letter');
  if (!/[0-9]/.test(password)) missing.push('a number');
  if (!/[^A-Za-z0-9]/.test(password)) missing.push('a symbol');
  return missing.length ? `Password needs ${missing.join(', ')}.` : null;
}

export function validateConfirmPassword(password: string, confirm: string): string | null {
  if (!confirm) return 'Please confirm your password.';
  return password === confirm ? null : 'Passwords do not match.';
}

export function validateName(name: string): string | null {
  const value = name.trim();
  if (!value) return 'Name is required.';
  if (value.length > NAME_MAX_LENGTH) return `Name must be ${NAME_MAX_LENGTH} characters or fewer.`;
  return null;
}

export function validateGender(gender: string): string | null {
  if (!gender) return 'Please select a gender option.';
  return (GENDER_OPTIONS as readonly string[]).includes(gender)
    ? null
    : 'Please select a valid gender option.';
}

/** Birthdate is optional. When given it must be YYYY-MM-DD, a real date, not in the future, and after 1900. */
export function validateBirthdate(
  birthdate: string | undefined,
  today = new Date(),
): string | null {
  if (!birthdate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return 'Date of birth must be in YYYY-MM-DD format.';
  const date = new Date(`${birthdate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birthdate) {
    return 'Date of birth is not a real date.';
  }
  if (date.getUTCFullYear() < 1900) return 'Date of birth must be after 1900.';
  if (birthdate > today.toISOString().slice(0, 10)) return 'Date of birth cannot be in the future.';
  return null;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  gender: string;
  birthdate?: string;
}

export type SignupErrors = Partial<Record<keyof SignupInput, string>>;

export function validateSignup(input: SignupInput): SignupErrors {
  const errors: SignupErrors = {};
  const checks: [keyof SignupInput, string | null][] = [
    ['name', validateName(input.name)],
    ['email', validateEmail(input.email)],
    ['password', validatePassword(input.password)],
    ['confirmPassword', validateConfirmPassword(input.password, input.confirmPassword)],
    ['gender', validateGender(input.gender)],
    ['birthdate', validateBirthdate(input.birthdate)],
  ];
  for (const [field, error] of checks) {
    if (error) errors[field] = error;
  }
  return errors;
}
