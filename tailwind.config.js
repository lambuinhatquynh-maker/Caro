/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Be Vietnam Pro"', 'system-ui', 'sans-serif'] },
      colors: {
        paper: '#F4F8FD',
        grid: '#BFD2EA',
        navy: '#18223F',
        margin: '#F1A7B8',
        'ink-blue': '#2342B8',
        'ink-red': '#D2362E',
      },
    },
  },
  plugins: [],
}
