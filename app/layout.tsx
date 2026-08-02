import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

import "./globals.css";

// Design System: one family, weights 400/500/600/700.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Business Manager",
    template: "%s · Business Manager",
  },
  description: "Beverages, bakery and milk shop management.",
};

// Mobile-first: lock the viewport so numeric inputs don't zoom the page.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#fafafa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={cn("min-h-dvh bg-background font-sans antialiased")}>
        <QueryProvider>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </QueryProvider>
      </body>
    </html>
  );
}
