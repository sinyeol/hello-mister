export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#171717',
        panel: '#f5f7fb',
        line: '#d8dee9',
        primary: '#2563eb',
        success: '#16a34a',
        warning: '#d97706',
        danger: '#dc2626',
        info: '#0891b2',
      },
      boxShadow: {
        surface: '0 1px 2px rgb(0 0 0 / 0.08)',
        selected: '0 0 0 3px rgb(37 99 235 / 0.2)',
      },
    },
  },
  plugins: [],
};
