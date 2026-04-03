/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#E8B84B", dark: "#C9962E", light: "#FBE79A" },
        dark:  { DEFAULT: "#0F172A", card: "#1E293B", border: "#334155" },
      },
      fontFamily: { sans: ["Inter","system-ui","sans-serif"] },
    },
  },
  plugins: [],
}
