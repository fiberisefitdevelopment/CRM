/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // CSS variable-driven semantic tokens
        border:      "var(--border)",
        input:       "var(--input-bg)",
        ring:        "var(--ring)",
        background:  "var(--background)",
        foreground:  "var(--foreground)",
        card: {
          DEFAULT:     "var(--card)",
          foreground:  "var(--foreground)",
          elevated:    "var(--card-elevated)",
        },
        muted: {
          DEFAULT:    "var(--border)",
          foreground: "var(--foreground-muted)",
        },
        accent: {
          DEFAULT:    "var(--accent-purple-light)",
          foreground: "var(--foreground)",
          purple:     "var(--accent-purple)",
          blue:       "var(--accent-blue)",
        },
        primary: {
          DEFAULT:    "#7C3AED",
          foreground: "#FFFFFF",
        },
        secondary: {
          DEFAULT:    "var(--card-elevated)",
          foreground: "var(--foreground-muted)",
        },
        destructive: {
          DEFAULT:    "#DC2626",
          foreground: "#FFFFFF",
        },
        sidebar: {
          bg:           "var(--sidebar-bg)",
          border:       "var(--sidebar-border)",
          text:         "var(--sidebar-text)",
          "text-active":"var(--sidebar-text-active)",
          "active-bg":  "var(--sidebar-active-bg)",
          "hover-bg":   "var(--sidebar-hover-bg)",
        },
        topbar: {
          bg:     "var(--topbar-bg)",
          border: "var(--topbar-border)",
        },
        // Direct color palette
        "fiberise-purple": "#7C3AED",
        "fiberise-blue":   "#2563EB",
      },
      borderRadius: {
        lg:  "var(--radius)",
        md:  "calc(var(--radius) - 2px)",
        sm:  "calc(var(--radius) - 4px)",
        xl:  "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        "2xs": "0.625rem",
        "3xs": "0.5rem",
      },
      boxShadow: {
        "card":     "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
        "card-lg":  "0 4px 16px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)",
        "purple":   "0 4px 16px rgba(124, 58, 237, 0.20)",
        "purple-lg":"0 8px 32px rgba(124, 58, 237, 0.30)",
        "glow":     "0 0 24px rgba(124, 58, 237, 0.25)",
      },
      keyframes: {
        "fade-in": {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-up": {
          "0%":   { opacity: "0", transform: "scale(0.95) translateY(4px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        "slide-down": {
          "0%":   { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-left": {
          "0%":   { opacity: "0", transform: "translateX(100%)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "slide-up": {
          "0%":   { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.6" },
        },
        "shimmer": {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-in":    "fade-in 0.3s ease-out",
        "scale-up":   "scale-up 0.25s ease-out",
        "slide-down": "slide-down 0.25s ease-out",
        "slide-left": "slide-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        "slide-up":   "slide-up 0.25s ease-out",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        "shimmer":    "shimmer 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // `light:` variant — applies when html does NOT have the .dark class
    function ({ addVariant }) {
      addVariant('light', ':root:not(.dark) &')
    },
  ],
}
