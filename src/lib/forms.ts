/** Moves keyboard focus to the first invalid field so screen-reader and keyboard users land on the error. */
export function focusFirstError(form: HTMLFormElement): void {
  // Wait for React to render the aria-invalid attributes before looking for them.
  requestAnimationFrame(() => {
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

export function validateCode(code: string): string | null {
  if (!code.trim()) return 'Enter the code from your email.';
  return /^\d{6}$/.test(code.trim()) ? null : 'The code is 6 digits.';
}
