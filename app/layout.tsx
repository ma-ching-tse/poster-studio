import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Poster Studio',
  description: 'BitMart 运营海报生成工具',
  icons: { icon: '/assets/listing/figma/_shared/logo-icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
