/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0d1117',
        panel: '#161b22',
        border: '#30363d',
        primary: '#4493f8',
        text: '#c9d1d9',
        muted: '#8b949e',
        success: '#3fb950',
        danger: '#f85149'
      }
    },
  },
  plugins: [],
}
