import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0b1020",
        panel: "#121a31",
        text: "#eaf0ff",
        muted: "#a5b1d8",
        accent: "#4de2c5",
        accent2: "#7aa2ff"
      },
      backgroundImage: {
        glow: "radial-gradient(900px circle at 10% 10%, rgba(77,226,197,0.2), transparent 35%), radial-gradient(900px circle at 90% 10%, rgba(122,162,255,0.2), transparent 35%)"
      }
    }
  },
  plugins: []
};

export default config;
