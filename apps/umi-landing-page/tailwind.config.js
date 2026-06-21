/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "umi-blue": {
          dark: "#223979",
          light: "#7692CB",
          deep: "#0A1430",
          80: "rgba(34, 57, 121, 0.8)",
          60: "rgba(34, 57, 121, 0.6)",
          40: "rgba(34, 57, 121, 0.4)",
        },
        "umi-light-blue": {
          DEFAULT: "#7692CB",
          soft: "#BFD1F2",
          80: "rgba(118, 146, 203, 0.8)",
          60: "rgba(118, 146, 203, 0.6)",
          40: "rgba(118, 146, 203, 0.4)",
        },
        "umi-paper": "#FBF7EF",
        "umi-paper-warm": "#EDE7DA",
        "umi-accent": "#E7A85B",
        "umi-ink": "#F2F6FF",
      },
      fontFamily: {
        domus: ["var(--font-nunito)", "sans-serif"],
        sans: ["var(--font-nunito)", "sans-serif"],
        serif: ["var(--font-fraunces)", "Georgia", "serif"],
        mono: ["var(--font-source-code)", "monospace"],
      },
      letterSpacing: {
        "wider-2": "0.2em",
        "wider-3": "0.22em",
      },
    },
  },
  plugins: [],
};
