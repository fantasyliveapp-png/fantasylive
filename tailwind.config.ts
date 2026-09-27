import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-body)', 'sans-serif'],
        brand: ['var(--font-brand)', 'sans-serif'],
        heading: ['var(--font-heading)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      colors: {
        // Paleta de marca (hex directos, ver BRAND_HANDOFF.md #4.5)
        'fantazy-red': '#C0273C',
        'onix-black': '#0E0D0F',
        'warm-white': '#F5F1EC',
        'champagne-gold': '#C9A876',
        'state-connected': '#4CAF6D',
        'state-alert': '#E0A73E',
        'surface-2': '#151315',
        'surface-3': '#201d1f',

        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        token: {
          DEFAULT: 'hsl(var(--token))',
          foreground: 'hsl(var(--token-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '80%, 100%': { transform: 'scale(1.4)', opacity: '0' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'heart-float': {
          '0%': { transform: 'translate(0, 0) scale(0.4)', opacity: '0' },
          '12%': { transform: 'translate(0, -20px) scale(1.1)', opacity: '1' },
          '100%': {
            transform: 'translate(var(--drift, 0px), -240px) scale(0.8)',
            opacity: '0',
          },
        },
        spotlight: {
          '0%': { transform: 'scale(0.3)', opacity: '0' },
          '15%': { transform: 'scale(1.15)', opacity: '1' },
          '25%, 80%': { transform: 'scale(1)', opacity: '1' },
          '100%': { transform: 'scale(1.1) translateY(-30px)', opacity: '0' },
        },
        'swipe-hint': {
          '0%, 100%': { transform: 'translateY(0)', opacity: '0.6' },
          '50%': { transform: 'translateY(-10px)', opacity: '1' },
        },
        'gift-pop': {
          '0%': { transform: 'translateX(-24px) scale(0.9)', opacity: '0' },
          '12%': { transform: 'translateX(0) scale(1.05)', opacity: '1' },
          '20%, 85%': { transform: 'translateX(0) scale(1)', opacity: '1' },
          '100%': { transform: 'translateY(-12px)', opacity: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.24, 0, 0.38, 1) infinite',
        shimmer: 'shimmer 2s infinite',
        'gift-pop': 'gift-pop 5s ease-out forwards',
        'heart-float': 'heart-float 2.4s ease-out forwards',
        spotlight: 'spotlight 2.8s ease-out forwards',
        'swipe-hint': 'swipe-hint 1.2s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
