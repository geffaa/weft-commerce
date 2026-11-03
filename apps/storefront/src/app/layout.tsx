import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Halden Moto Parts",
  description: "Motorcycle parts that fit your bike. Synthetic demo store.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;500;600;650;700&family=Spline+Sans+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
