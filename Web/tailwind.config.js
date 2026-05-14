/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#FFCC00", dark: "#D9AA00", light: "#FFE680", blue: "#0066FF" },
        dark:  { DEFAULT: "#0B0F19", card: "#111827", border: "#273244" },
      },
      fontFamily: {
        sans: ["Inter","system-ui","sans-serif"],
        display: ["Montserrat","Inter","system-ui","sans-serif"],
      },
    },
  },
  plugins: [],
}
