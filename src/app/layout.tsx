import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4f0" },
    { media: "(prefers-color-scheme: dark)", color: "#2e2a26" },
  ],
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "MOIL Intelligence — Manganese Prospectivity & Production Command Center",
  description:
    "AI/ML-based manganese prospectivity mapping and production shortfall prediction system for MOIL Limited. Smart India Hackathon 2026 · PS SIH26-26009 · Ministry of Steel: prospectivity mapping (demo + real Balaghat public-data pipeline), 4-week shortfall forecasting with explainable attribution, and ranked corrective actions.",
  keywords: [
    "MOIL",
    "manganese",
    "reserve estimation",
    "production shortfall prediction",
    "Smart India Hackathon 2026",
    "SIH 2026",
    "PS 26009",
    "Ministry of Steel",
    "explainable ML",
  ],
  authors: [{ name: "SIH 2026 Team — PS SIH26-26009" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
