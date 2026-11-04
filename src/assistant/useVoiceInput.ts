import { useCallback, useEffect, useRef, useState } from 'react';
import { getRecognizerConstructor, recognitionErrorMessage, type Recognizer } from './speech';

/**
 * Microphone input. While listening, `onTranscript` receives the words heard so far; the text
 * goes into the message box for the user to check and send (it is never sent automatically,
 * so a misheard "yes" cannot confirm a deletion by itself).
 */
export function useVoiceInput(onTranscript: (text: string) => void) {
  const [supported] = useState(() => getRecognizerConstructor() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  // Stop listening when the panel closes.
  useEffect(() => () => recognizerRef.current?.abort(), []);

  const start = useCallback(() => {
    const Recognizer = getRecognizerConstructor();
    if (!Recognizer || recognizerRef.current) return;
    const recognizer = new Recognizer();
    recognizer.lang = navigator.language || 'en-IN';
    recognizer.interimResults = true;
    recognizer.continuous = false;
    recognizer.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      onTranscriptRef.current(text.trim());
    };
    recognizer.onerror = (event) => {
      // "aborted" means we stopped it on purpose.
      if (event.error !== 'aborted') setError(recognitionErrorMessage(event.error));
    };
    recognizer.onend = () => {
      recognizerRef.current = null;
      setListening(false);
    };
    setError(null);
    try {
      recognizer.start();
      recognizerRef.current = recognizer;
      setListening(true);
    } catch {
      setError(recognitionErrorMessage('unknown'));
    }
  }, []);

  const stop = useCallback(() => {
    recognizerRef.current?.stop();
  }, []);

  return { supported, listening, error, start, stop };
}
