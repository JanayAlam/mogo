import type { Metadata } from "next";
import { JetBrains_Mono, Poppins } from "next/font/google";
import NextTopLoader from "nextjs-toploader";

import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "mogo",
  description: "Projects, repos and feature checks: an AI agent tests and reviews your pull requests",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <NextTopLoader color="var(--primary)" height={2} showSpinner={false} shadow="0 0 8px var(--primary)" />
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
