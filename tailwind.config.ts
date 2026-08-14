import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#24313D",
        brand: "#3E6F8E",
        "brand-dark": "#2E566F",
        "record-health": "#047857",
        "record-health-soft": "#ECFDF5",
        "record-medical": "#0369A1",
        "record-medical-soft": "#F0F9FF",
        "record-medication": "#6D28D9",
        "record-medication-soft": "#F5F3FF",
        "record-vaccination": "#B45309",
        "record-vaccination-soft": "#FFFBEB",
        "record-memory": "#BE123C",
        "record-memory-soft": "#FFF1F2",
        accent: "#D97955",
        "care-walk": "#3F7F78",
        "care-litter": "#7568A6",
        "species-dog": "#2E6FAE",
        "species-dog-soft": "#EAF2FC",
        "species-cat": "#A95622",
        "species-cat-soft": "#FDF0E5",
        highlight: "#F2C879",
        canvas: "#F5F7FA",
        "surface-warm": "#FFF8F1"
      },
      boxShadow: {
        panel: "0 8px 24px rgba(36, 49, 61, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
