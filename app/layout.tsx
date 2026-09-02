import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gesture Conductor',
  description: '손등 다중 마커 기반 3D 지휘 인터페이스와 로컬 실시간 오디오 믹서',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
