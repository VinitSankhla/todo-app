import { confirmResetPassword, resetPassword } from 'aws-amplify/auth';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  normalizeEmail,
  validateConfirmPassword,
  validateEmail,
  validatePassword,
} from '../../shared/validation';
import { Alert, AuthCard, Button, TextField } from '../components/ui';
import { getAuthErrorMessage } from '../lib/auth-errors';
import { focusFirstError, validateCode } from '../lib/forms';

type Errors = Partial<Record<'email' | 'code' | 'password' | 'confirmPassword', string>>;

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError('');
    const emailError = validateEmail(email);
    setErrors({ email: emailError ?? undefined });
    if (emailError) {
      focusFirstError(event.currentTarget);
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword({ username: normalizeEmail(email) });
      setStep('reset');
    } catch (error) {
      setSubmitError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError('');
    const nextErrors: Errors = {
      code: validateCode(code) ?? undefined,
      password: validatePassword(password) ?? undefined,
      confirmPassword: validateConfirmPassword(password, confirmPassword) ?? undefined,
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      focusFirstError(event.currentTarget);
      return;
    }
    setSubmitting(true);
    try {
      await confirmResetPassword({
        username: normalizeEmail(email),
        confirmationCode: code.trim(),
        newPassword: password,
      });
      navigate('/login', {
        state: {
          message: 'Password changed. Log in with your new password.',
          email: normalizeEmail(email),
        },
      });
    } catch (error) {
      setSubmitError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Reset your password">
      {step === 'request' ? (
        <form noValidate onSubmit={handleRequest} className="space-y-4">
          <p className="text-sm text-slate-600">
            Enter your Gmail address and we will email you a code to reset your password.
          </p>
          {submitError && <Alert kind="error">{submitError}</Alert>}
          <TextField
            id="email"
            label="Gmail address"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <Button type="submit" loading={submitting} className="w-full">
            Send reset code
          </Button>
        </form>
      ) : (
        <form noValidate onSubmit={handleReset} className="space-y-4">
          <Alert kind="success">
            If an account exists for {normalizeEmail(email)}, a code has been sent to it.
          </Alert>
          {submitError && <Alert kind="error">{submitError}</Alert>}
          <TextField
            id="code"
            label="Reset code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={errors.code}
          />
          <TextField
            id="password"
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <TextField
            id="confirmPassword"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            error={errors.confirmPassword}
          />
          <Button type="submit" loading={submitting} className="w-full">
            Change password
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-slate-600">
        <Link to="/login" className="font-medium text-indigo-700 hover:underline">
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}
