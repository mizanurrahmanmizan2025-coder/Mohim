import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { plainText } from '../utils/helpers.js';

const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export const VOICE_LANGS = [
  { code: 'en-US', label: 'English' },
  { code: 'bn-BD', label: 'বাংলা' },
  { code: 'hi-IN', label: 'हिन्दी' },
  { code: 'ar-SA', label: 'العربية' },
];
export const getVoiceLang = () => localStorage.getItem('voiceLang') || 'en-US';
export const setVoiceLang = (l) => localStorage.setItem('voiceLang', l);

/* ───── Speech-to-text button ───── */
export default function VoiceInput({ onTranscript, disabled }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  useEffect(() => () => recRef.current?.abort(), []);

  if (!Recognition) return null; // browser has no speech recognition (e.g. Firefox)

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Recognition();
    rec.lang = getVoiceLang();
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      onTranscript(finalText + interim, false);
    };
    rec.onend = () => {
      setListening(false);
      if (finalText) onTranscript(finalText, true);
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      className={`btn-icon ${listening ? 'animate-pulse bg-red-500/15 text-red-500' : ''}`}
      title={listening ? 'Stop listening' : 'Voice input'}
    >
      {listening ? <MicOff size={20} /> : <Mic size={20} />}
    </button>
  );
}

/* ───── Text-to-speech ───── */
export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export function speak(markdown, onEnd) {
  if (!ttsSupported) return;
  window.speechSynthesis.cancel();
  const text = plainText(markdown);
  if (!text) return;
  const lang = getVoiceLang();
  // long texts are chunked — some browsers stop after ~15 s on a single utterance
  const chunks = text.match(/[^.!?।]+[.!?।]*\s*/g) || [text];
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    u.lang = lang;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang === lang);
    if (voice) u.voice = voice;
    if (i === chunks.length - 1 && onEnd) u.onend = onEnd;
    window.speechSynthesis.speak(u);
  });
}

export const stopSpeaking = () => ttsSupported && window.speechSynthesis.cancel();
