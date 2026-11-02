import { signUp } from 'aws-amplify/auth';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  GENDER_OPTIONS,
  normalizeEmail,
  validateSignup,
  type SignupErrors,
  type SignupInput,
} from '../../shared/validation';
import { Alert, AuthCard, Button, SelectField, TextField } from '../components/ui';
import { getAuthErrorMessage } from '../lib/auth-errors';
import { focusFirstError } from '../lib/forms';

const EMPTY_FORM: SignupInput = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  gender: '',
  birthdate: '',
};

export default function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<SignupInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<SignupErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof SignupInput) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError('');
    const validationErrors = validateSignup(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      focusFirstError(event.currentTarget);
      return;
    }

    const email = normalizeEmail(form.email);
    setSubmitting(true);
    try {
      await signUp({
        username: email,
        password: form.password,
        options: {
          userAttributes: {
            email,
            name: form.name.trim(),
            gender: form.gender,
            ...(form.birthdate ? { birthdate: form.birthdate } : {}),
          },
        },
      });
      navigate(`/confirm-signup?email=${encodeURIComponent(email)}`);
    } catch (error) {
      setSubmitError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Create your account">
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {submitError && <Alert kind="error">{submitError}</Alert>}
        <TextField
          id="name"
          label="Name"
          autoComplete="name"
          value={form.name}
          onChange={(e) => update('name')(e.target.value)}
          error={errors.name}
        />
        <TextField
          id="email"
          label="Gmail address"
          type="email"
          autoComplete="email"
          hint="Only @gmail.com addresses are accepted."
          value={form.email}
          onChange={(e) => update('email')(e.target.value)}
          error={errors.email}
        />
        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol."
          value={form.password}
          onChange={(e) => update('password')(e.target.value)}
          error={errors.password}
        />
        <TextField
          id="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={(e) => update('confirmPassword')(e.target.value)}
          error={errors.confirmPassword}
        />
        <SelectField
          id="gender"
          label="Gender"
          placeholder="Select…"
          options={GENDER_OPTIONS}
          value={form.gender}
          onChange={(e) => update('gender')(e.target.value)}
          error={errors.gender}
        />
        <TextField
          id="birthdate"
          label="Date of birth"
          type="date"
          optional
          autoComplete="bday"
          value={form.birthdate}
          onChange={(e) => update('birthdate')(e.target.value)}
          error={errors.birthdate}
        />
        <Button type="submit" loading={submitting} className="w-full">
          Sign up
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-indigo-700 hover:underline">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
