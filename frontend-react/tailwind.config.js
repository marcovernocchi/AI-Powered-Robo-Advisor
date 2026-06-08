/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@tremor/**/*.{js,ts,jsx,tsx}',
  ],
  safelist: [
    {
      // Tremor DonutChart builds fill class names dynamically at runtime —
      // Tailwind can't detect them via static scanning, so we force-include them.
      pattern: /^(fill|stroke|text|bg|border|ring)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]+$/,
      variants: ['dark'],
    },
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
