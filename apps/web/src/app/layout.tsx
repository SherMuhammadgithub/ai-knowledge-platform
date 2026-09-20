import type { Metadata } from "next";
import Script from "next/script";
import { JetBrains_Mono, Newsreader, Public_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { THEME_INIT_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

// Public Sans: interface text. Newsreader: prose people read (answers, source passages).
// JetBrains Mono: numbers, scores, ids. Roles are defined in docs/FRONTEND_RULES.md.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Knowledge Platform",
  description: "Ask questions about your documents and get answers with sources.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${publicSans.variable} ${newsreader.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
