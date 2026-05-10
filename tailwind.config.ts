import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#070B14"
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(99, 102, 241, 0.25), 0 10px 40px rgba(0, 0, 0, 0.6)"
      }
    }
  },
  plugins: []
};

export default config;

