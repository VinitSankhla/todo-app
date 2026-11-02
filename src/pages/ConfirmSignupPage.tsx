import { confirmSignUp, resendSignUpCode } from 'aws-amplify/auth';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { normalizeEmail, validateEmail } from '../../shared/validation';
import { Alert, AuthCard, Button, TextField } from '../components/ui';
import { getAuthErrorMessage } from '../lib/auth-errors';
import { focusFirstError, validateCode } from '../lib/forms';

export default function ConfirmSignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ email?: string; code?: string }>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const nextErrors = {
      email: validateEmail(email) ?? undefined,
      code: validateCode(code) ?? undefined,
    };
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.code) {
      focusFirstError(event.currentTarget);
      return;
    }

    setSubmitting(true);
    try {
      await confirmSignUp({ username: normalizeEmail(email), confirmationCode: code.trim() });
      navigate('/login', {
        state: { message: 'Email verified! You can now log in.', email: normalizeEmail(email) },
      });
    } catch (error) {
      setMessage({ kind: 'error', text: getAuthErrorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setMessage(null);
    const emailError = validateEmail(email);
    if (emailError) {
      setErrors({ email: emailError });
      return;
    }
    setResending(true);
    try {
      await resendSignUpCode({ username: normalizeEmail(email) });
      setMessage({ kind: 'success', text: 'A new code has been sent to your email.' });
    } catch (error) {
      setMessage({ kind: 'error', text: getAuthErrorMessage(error) });
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthCard title="Verify your email">
      <p className="mb-4 text-sm text-slate-600">
        We sent a 6-digit code to your Gmail. It can take a minute to arrive — check your Spam
        folder too.
      </p>
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {message && <Alert kind={message.kind}>{message.text}</Alert>}
        <TextField
          id="email"
          label="Gmail address"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <TextField
          id="code"
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={errors.code}
        />
        <Button type="submit" loading={submitting} className="w-full">
          Verify email
        </Button>
        <Button variant="secondary" loading={resending} onClick={handleResend} className="w-full">
          Resend code
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        <Link to="/login" className="font-medium text-indigo-700 hover:underline">
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}
