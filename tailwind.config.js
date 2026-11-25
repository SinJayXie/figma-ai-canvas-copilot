/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/ui/**/*.{vue,ts,html}'],
  theme: {
    extend: {
      colors: {
        /**
         * figma-* 作为语义令牌保留（组件里大量使用），值统一映射到 iOS 系统语义色：
         * grouped background / card / separator / label / secondary label / system blue
         */
        figma: {
          bg: '#F2F2F7',
          'bg-dark': '#000000',
          surface: '#FFFFFF',
          'surface-dark': '#1C1C1E',
          border: '#C6C6C8',
          'border-dark': '#38383A',
          text: '#000000',
          'text-dark': '#FFFFFF',
          'text-secondary': '#6C6C70',
          primary: '#007AFF',
          'primary-dark': '#0A84FF'
        },
        /** iOS 系统色（亮色 / 暗色成对） */
        ios: {
          blue: '#007AFF',
          'blue-dark': '#0A84FF',
          green: '#34C759',
          'green-dark': '#30D158',
          red: '#FF3B30',
          'red-dark': '#FF453A',
          orange: '#FF9500',
          'orange-dark': '#FF9F0A',
          purple: '#AF52DE',
          'purple-dark': '#BF5AF2',
          teal: '#30B0C7',
          'teal-dark': '#40C8E0',
          yellow: '#FFCC00',
          'yellow-dark': '#FFD60A',
          pink: '#FF2D55',
          'pink-dark': '#FF375F',
          gray: '#8E8E93',
          'gray-dark': '#98989D',
          /** 分组背景 / 卡片 / 填充 / 分隔线 / 文本层级 */
          grouped: '#F2F2F7',
          'grouped-dark': '#000000',
          card: '#FFFFFF',
          'card-dark': '#1C1C1E',
          fill: '#EFEFF0',
          'fill-dark': '#2C2C2E',
          'fill-secondary': '#E5E5EA',
          'fill-secondary-dark': '#3A3A3C',
          separator: '#C6C6C8',
          'separator-dark': '#38383A',
          label: '#000000',
          'label-dark': '#FFFFFF',
          'label-secondary': '#6C6C70',
          'label-secondary-dark': '#98989D',
          'label-tertiary': '#AEAEB2',
          'label-tertiary-dark': '#636366'
        }
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"PingFang SC"',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif'
        ]
      },
      spacing: {
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '6': '24px'
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '16px'
      }
    }
  },
  plugins: []
}
