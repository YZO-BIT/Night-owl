import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import ClientHydrationGuard from "@/components/ClientHydrationGuard";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Neon Odyssey",
  description: "AI-Powered Gamified Learning Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ClientHydrationGuard>
          <ThemeSwitcher />
          {children}
        </ClientHydrationGuard>
      </body>
    </html>
  );
}
