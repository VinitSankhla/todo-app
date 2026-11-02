import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  confirmResetPassword,
  confirmSignUp,
  fetchUserAttributes,
  getCurrentUser,
  resendSignUpCode,
  resetPassword,
  signIn,
  signOut,
  signUp,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthProvider';

vi.mock('aws-amplify/auth', () => ({
  confirmResetPassword: vi.fn(),
  confirmSignUp: vi.fn(),
  fetchUserAttributes: vi.fn(),
  getCurrentUser: vi.fn(),
  resendSignUpCode: vi.fn(),
  resetPassword: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
}));
vi.mock('aws-amplify/utils', () => ({ Hub: { listen: vi.fn() } }));

type SignInResult = Awaited<ReturnType<typeof signIn>>;

function awsError(name: string, message = name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function mockSignedOut() {
  vi.mocked(getCurrentUser).mockRejectedValue(awsError('UserUnAuthenticatedException'));
}

function mockSignedIn() {
  vi.mocked(getCurrentUser).mockResolvedValue({ userId: 'user-1', username: 'user-1' });
  vi.mocked(fetchUserAttributes).mockResolvedValue({ email: 'vinit@gmail.com', name: 'Vinit' });
}

function renderAt(path: string) {
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
  return user;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(Hub.listen).mockReturnValue(() => undefined);
  mockSignedOut();
});

describe('protected routes', () => {
  it('redirects logged-out users from /tasks to the login page', async () => {
    renderAt('/tasks');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('sends logged-in users from /login to their tasks', async () => {
    mockSignedIn();
    renderAt('/login');
    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeInTheDocument();
    expect(screen.getByText('Vinit')).toBeInTheDocument();
  });
});

describe('signup page', () => {
  async function fillValidForm(
    user: ReturnType<typeof userEvent.setup>,
    email = 'Vinit@Gmail.com',
  ) {
    await user.type(screen.getByLabelText('Name'), 'Vinit');
    await user.type(screen.getByLabelText('Gmail address'), email);
    await user.type(screen.getByLabelText('Password'), 'Abcdef1!');
    await user.type(screen.getByLabelText('Confirm password'), 'Abcdef1!');
    await user.selectOptions(screen.getByLabelText('Gender'), 'Male');
  }

  it('shows an error for every invalid field and does not call Cognito', async () => {
    const user = renderAt('/signup');
    await user.click(await screen.findByRole('button', { name: 'Sign up' }));

    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    expect(screen.getByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(screen.getByText('Please confirm your password.')).toBeInTheDocument();
    expect(screen.getByText('Please select a gender option.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus());
    expect(signUp).not.toHaveBeenCalled();
  });

  it('rejects non-Gmail addresses, "+" addresses, weak and mismatched passwords', async () => {
    const user = renderAt('/signup');
    await user.type(await screen.findByLabelText('Gmail address'), 'vinit@yahoo.com');
    await user.type(screen.getByLabelText('Password'), 'weakpass');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(screen.getByText('Only @gmail.com addresses are allowed.')).toBeInTheDocument();
    expect(
      screen.getByText(/Password needs an uppercase letter, a number, a symbol/),
    ).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Gmail address'));
    await user.type(screen.getByLabelText('Gmail address'), 'vinit+x@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(screen.getByText('Gmail addresses containing "+" are not allowed.')).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it('signs up with a normalized email and goes to the confirmation page', async () => {
    vi.mocked(signUp).mockResolvedValue({
      isSignUpComplete: false,
      nextStep: { signUpStep: 'CONFIRM_SIGN_UP', codeDeliveryDetails: {} },
    });
    const user = renderAt('/signup');
    await screen.findByLabelText('Name');
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(signUp).toHaveBeenCalledWith({
      username: 'vinit@gmail.com',
      password: 'Abcdef1!',
      options: { userAttributes: { email: 'vinit@gmail.com', name: 'Vinit', gender: 'Male' } },
    });
    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Gmail address')).toHaveValue('vinit@gmail.com');
  });

  it('shows server-side errors from Cognito', async () => {
    vi.mocked(signUp).mockRejectedValue(awsError('UsernameExistsException'));
    const user = renderAt('/signup');
    await screen.findByLabelText('Name');
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email already exists.',
    );
  });

  it('shows the reason from the pre-sign-up trigger without the Cognito prefix', async () => {
    vi.mocked(signUp).mockRejectedValue(
      awsError(
        'UserLambdaValidationException',
        'PreSignUp failed with error Only @gmail.com addresses are allowed..',
      ),
    );
    const user = renderAt('/signup');
    await screen.findByLabelText('Name');
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Only @gmail.com addresses are allowed\.$/,
    );
  });
});

describe('confirm signup page', () => {
  it('requires a 6-digit code', async () => {
    const user = renderAt('/confirm-signup?email=vinit%40gmail.com');
    await user.type(await screen.findByLabelText('Verification code'), '12ab');
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(screen.getByText('The code is 6 digits.')).toBeInTheDocument();
    expect(confirmSignUp).not.toHaveBeenCalled();
  });

  it('confirms the code and sends the user to log in', async () => {
    vi.mocked(confirmSignUp).mockResolvedValue({
      isSignUpComplete: true,
      nextStep: { signUpStep: 'DONE' },
    });
    const user = renderAt('/confirm-signup?email=vinit%40gmail.com');
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify email' }));

    expect(confirmSignUp).toHaveBeenCalledWith({
      username: 'vinit@gmail.com',
      confirmationCode: '123456',
    });
    expect(await screen.findByText('Email verified! You can now log in.')).toBeInTheDocument();
  });

  it('shows a clear error for a wrong code and can resend it', async () => {
    vi.mocked(confirmSignUp).mockRejectedValue(awsError('CodeMismatchException'));
    vi.mocked(resendSignUpCode).mockResolvedValue(
      {} as Awaited<ReturnType<typeof resendSignUpCode>>,
    );
    const user = renderAt('/confirm-signup?email=vinit%40gmail.com');
    await user.type(await screen.findByLabelText('Verification code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is incorrect.');

    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    expect(resendSignUpCode).toHaveBeenCalledWith({ username: 'vinit@gmail.com' });
    expect(await screen.findByRole('status')).toHaveTextContent('A new code has been sent');
  });
});

describe('login page', () => {
  it('validates input before calling Cognito', async () => {
    const user = renderAt('/login');
    await user.click(await screen.findByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('logs in and shows the tasks page', async () => {
    vi.mocked(signIn).mockImplementation(async () => {
      mockSignedIn();
      return { isSignedIn: true, nextStep: { signInStep: 'DONE' } } as SignInResult;
    });
    const user = renderAt('/login');
    await user.type(await screen.findByLabelText('Gmail address'), 'Vinit@gmail.com');
    await user.type(screen.getByLabelText('Password'), 'Abcdef1!');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(signIn).toHaveBeenCalledWith({ username: 'vinit@gmail.com', password: 'Abcdef1!' });
    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeInTheDocument();
  });

  it('shows a generic message for wrong credentials', async () => {
    vi.mocked(signIn).mockRejectedValue(awsError('NotAuthorizedException'));
    const user = renderAt('/login');
    await user.type(await screen.findByLabelText('Gmail address'), 'vinit@gmail.com');
    await user.type(screen.getByLabelText('Password'), 'Wrong1!pass');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('sends unverified users to the confirmation page', async () => {
    vi.mocked(signIn).mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_UP' },
    } as SignInResult);
    const user = renderAt('/login');
    await user.type(await screen.findByLabelText('Gmail address'), 'vinit@gmail.com');
    await user.type(screen.getByLabelText('Password'), 'Abcdef1!');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
  });
});

describe('logout', () => {
  it('signs out and returns to the login page', async () => {
    mockSignedIn();
    vi.mocked(signOut).mockResolvedValue();
    const user = renderAt('/tasks');
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(signOut).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });
});

describe('forgot password', () => {
  it('requests a code, then sets a new password', async () => {
    vi.mocked(resetPassword).mockResolvedValue({} as Awaited<ReturnType<typeof resetPassword>>);
    vi.mocked(confirmResetPassword).mockResolvedValue();
    const user = renderAt('/forgot-password');

    await user.type(await screen.findByLabelText('Gmail address'), 'vinit@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));
    expect(resetPassword).toHaveBeenCalledWith({ username: 'vinit@gmail.com' });

    await user.type(await screen.findByLabelText('Reset code'), '123456');
    await user.type(screen.getByLabelText('New password'), 'weak');
    await user.type(screen.getByLabelText('Confirm new password'), 'weak');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByText(/Password needs/)).toBeInTheDocument();
    expect(confirmResetPassword).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('New password'), 'NewPass1!');
    await user.type(screen.getByLabelText('Confirm new password'), 'NewPass1!');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(confirmResetPassword).toHaveBeenCalledWith({
      username: 'vinit@gmail.com',
      confirmationCode: '123456',
      newPassword: 'NewPass1!',
    });
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
  });
});
