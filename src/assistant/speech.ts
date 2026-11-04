/**
 * Voice input and spoken replies with the browser's built-in Web Speech API.
 * Support varies: Chrome, Edge and Safari can listen; Firefox cannot. Most browsers can speak.
 * Note: in Chrome, speech recognition sends the recorded audio to Google to turn it into text.
 */

/** The parts of the (not yet standard-typed) SpeechRecognition API this app uses. */
export interface Recognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type RecognizerConstructor = new () => Recognizer;

export function getRecognizerConstructor(): RecognizerConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as unknown as {
    SpeechRecognition?: RecognizerConstructor;
    webkitSpeechRecognition?: RecognizerConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function canSpeak(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

/** Reads `text` aloud, replacing anything currently being spoken. */
export function speak(text: string): void {
  if (!canSpeak() || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = navigator.language || 'en-IN';
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}

/** A user-friendly message for a speech recognition error code. */
export function recognitionErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow it in your browser settings, or type your message instead.';
    case 'no-speech':
      return "I didn't hear anything. Try again, or type your message instead.";
    case 'audio-capture':
      return 'No microphone was found. Please type your message instead.';
    case 'network':
      return 'Voice input needs an internet connection. Please type your message instead.';
    default:
      return 'Voice input stopped working. Please type your message instead.';
  }
}

const SPEAK_REPLIES_KEY = 'assistant.speakReplies';

/** The user's "Read replies aloud" choice, remembered in this browser only. */
export function loadSpeakReplies(): boolean {
  try {
    return window.localStorage.getItem(SPEAK_REPLIES_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveSpeakReplies(value: boolean): void {
  try {
    window.localStorage.setItem(SPEAK_REPLIES_KEY, String(value));
  } catch {
    // Storage can be blocked (private mode); the choice then lasts until the page reloads.
  }
}
