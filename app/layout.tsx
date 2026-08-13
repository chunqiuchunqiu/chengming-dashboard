import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "澄明｜个人看板",
  description: "只读、可追溯的个人资产、股票研究与日程看板。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
