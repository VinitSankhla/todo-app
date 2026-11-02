/** Turns Cognito / Amplify errors into short, friendly messages for the UI. */
export function getAuthErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Something went wrong. Please try again.';

  switch (error.name) {
    case 'UsernameExistsException':
      return 'An account with this email already exists. Try logging in instead.';
    case 'NotAuthorizedException':
      return 'Incorrect email or password.';
    case 'UserNotFoundException':
      return 'Incorrect email or password.';
    case 'UserNotConfirmedException':
      return 'Please verify your email before logging in.';
    case 'CodeMismatchException':
      return 'That code is incorrect. Please check your email and try again.';
    case 'ExpiredCodeException':
      return 'That code has expired. Please request a new one.';
    case 'InvalidPasswordException':
      return 'Password needs at least 8 characters, an uppercase letter, a lowercase letter, a number and a symbol.';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
    case 'TooManyFailedAttemptsException':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'NetworkError':
      return 'Network error. Check your internet connection and try again.';
    case 'UserLambdaValidationException':
      // Message from our pre-sign-up trigger: "PreSignUp failed with error <reason>."
      return error.message.replace(/^PreSignUp failed with error\s*/i, '').replace(/\.\.$/, '.');
    default:
      return error.message || 'Something went wrong. Please try again.';
  }
}
