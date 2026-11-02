import { signIn } from 'aws-amplify/auth';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { normalizeEmail, validateEmail } from '../../shared/validation';
import { useAuth } from '../auth/auth-context';
import { Alert, AuthCard, Button, TextField } from '../components/ui';
import { getAuthErrorMessage } from '../lib/auth-errors';
import { focusFirstError } from '../lib/forms';

interface LoginLocationState {
  from?: string;
  message?: string;
  email?: string;
}

export default function LoginPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state ?? {}) as LoginLocationState;

  const [email, setEmail] = useState(locationState.email ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError('');
    const nextErrors = {
      email: validateEmail(email) ?? undefined,
      password: password ? undefined : 'Password is required.',
    };
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) {
      focusFirstError(event.currentTarget);
      return;
    }

    const username = normalizeEmail(email);
    setSubmitting(true);
    try {
      const { isSignedIn, nextStep } = await signIn({ username, password });
      if (isSignedIn) {
        // Updating auth state lets PublicOnlyRoute redirect to the requested page (or /tasks).
        await refresh();
        return;
      }
      if (nextStep.signInStep === 'CONFIRM_SIGN_UP') {
        navigate(`/confirm-signup?email=${encodeURIComponent(username)}`);
        return;
      }
      setSubmitError('This sign-in step is not supported. Please contact support.');
    } catch (error) {
      setSubmitError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Log in">
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {locationState.message && !submitError && (
          <Alert kind="success">{locationState.message}</Alert>
        )}
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
        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <div className="text-right text-sm">
          <Link to="/forgot-password" className="font-medium text-indigo-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" loading={submitting} className="w-full">
          Log in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        New here?{' '}
        <Link to="/signup" className="font-medium text-indigo-700 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
