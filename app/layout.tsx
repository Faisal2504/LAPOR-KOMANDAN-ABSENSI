import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JibblePro — Absensi GPS, Selfie, Kiosk & Offline",
  description: "Aplikasi absensi online & offline lengkap bergaya Jibble 2",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#ff6b00",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <head>
        <link rel="apple-touch-icon" href="https://cdn-icons-png.flaticon.com/512/2991/2991148.png" />
      </head>
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function() {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
