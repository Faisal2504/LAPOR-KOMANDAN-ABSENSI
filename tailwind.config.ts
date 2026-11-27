import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        jibble: {
          orange: "#FF6B00",
          dark: "#1E293B",
          light: "#F8FAFC",
        },
      },
    },
  },
  plugins: [],
};

export default config;
