import { describe, expect, it } from 'vitest';
import {
  validateBirthdate,
  validateConfirmPassword,
  validateEmail,
  validateGender,
  validateName,
  validatePassword,
  validateSignup,
} from './validation';

describe('validateEmail', () => {
  it.each(['john@gmail.com', 'John.Doe@Gmail.com', '  a1.b2@gmail.com  '])(
    'accepts %s',
    (email) => {
      expect(validateEmail(email)).toBeNull();
    },
  );

  it.each([
    ['', 'Email is required.'],
    ['john@yahoo.com', 'Only @gmail.com addresses are allowed.'],
    ['john@gmail.co', 'Only @gmail.com addresses are allowed.'],
    ['john@googlemail.com', 'Only @gmail.com addresses are allowed.'],
    ['john@gmail.com.evil.com', 'Only @gmail.com addresses are allowed.'],
    ['john+spam@gmail.com', 'Gmail addresses containing "+" are not allowed.'],
    ['john.@gmail.com', 'Enter a valid Gmail address.'],
    ['.john@gmail.com', 'Enter a valid Gmail address.'],
    ['jo..hn@gmail.com', 'Enter a valid Gmail address.'],
    ['jo hn@gmail.com', 'Enter a valid Gmail address.'],
    ['@gmail.com', 'Enter a valid Gmail address.'],
    [`${'a'.repeat(65)}@gmail.com`, 'Enter a valid Gmail address.'],
  ])('rejects %j', (email, message) => {
    expect(validateEmail(email)).toBe(message);
  });
});

describe('validatePassword', () => {
  it('accepts a password with upper, lower, number and symbol', () => {
    expect(validatePassword('Abcdef1!')).toBeNull();
  });

  it('lists every missing requirement', () => {
    expect(validatePassword('abc')).toBe(
      'Password needs at least 8 characters, an uppercase letter, a number, a symbol.',
    );
  });

  it.each(['abcdefg1!', 'ABCDEFG1!', 'Abcdefgh!', 'Abcdefgh1'])('rejects %s', (pw) => {
    expect(validatePassword(pw)).not.toBeNull();
  });
});

describe('other fields', () => {
  it('checks password confirmation', () => {
    expect(validateConfirmPassword('Abcdef1!', 'Abcdef1!')).toBeNull();
    expect(validateConfirmPassword('Abcdef1!', 'Abcdef1?')).toBe('Passwords do not match.');
  });

  it('requires a name of reasonable length', () => {
    expect(validateName('  ')).toBe('Name is required.');
    expect(validateName('a'.repeat(101))).toMatch(/100 characters/);
    expect(validateName('Vinit')).toBeNull();
  });

  it('only allows listed gender options', () => {
    expect(validateGender('Female')).toBeNull();
    expect(validateGender('')).toBe('Please select a gender option.');
    expect(validateGender('robot')).toBe('Please select a valid gender option.');
  });

  it('treats birthdate as optional but validates it when present', () => {
    const today = new Date('2026-11-02T12:00:00Z');
    expect(validateBirthdate(undefined, today)).toBeNull();
    expect(validateBirthdate('', today)).toBeNull();
    expect(validateBirthdate('2000-01-31', today)).toBeNull();
    expect(validateBirthdate('31-01-2000', today)).toMatch(/YYYY-MM-DD/);
    expect(validateBirthdate('2001-02-29', today)).toBe('Date of birth is not a real date.');
    expect(validateBirthdate('1899-12-31', today)).toMatch(/after 1900/);
    expect(validateBirthdate('2026-11-03', today)).toMatch(/future/);
  });
});

describe('validateSignup', () => {
  it('returns no errors for a valid form', () => {
    expect(
      validateSignup({
        name: 'Vinit',
        email: 'vinit@gmail.com',
        password: 'Abcdef1!',
        confirmPassword: 'Abcdef1!',
        gender: 'Male',
      }),
    ).toEqual({});
  });

  it('returns one error per invalid field', () => {
    const errors = validateSignup({
      name: '',
      email: 'x@yahoo.com',
      password: 'weak',
      confirmPassword: 'other',
      gender: '',
      birthdate: 'nope',
    });
    expect(Object.keys(errors).sort()).toEqual(
      ['birthdate', 'confirmPassword', 'email', 'gender', 'name', 'password'].sort(),
    );
  });
});
