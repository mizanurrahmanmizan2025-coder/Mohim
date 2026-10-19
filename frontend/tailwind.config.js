import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          side: '#f0f4f9',
          card: '#f0f4f9',
          hover: '#e3e8ee',
          dark: '#131314',
          darkside: '#1e1f20',
          darkcard: '#1e1f20',
          darkhover: '#2a2b2e',
        },
      },
    },
  },
  plugins: [typography],
};
