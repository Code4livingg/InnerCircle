import type { Metadata } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import "./globals.css";
import { WalletProviders } from "../components/WalletProviders";
import { Navbar } from "../components/Navbar";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "InnerCircle — Private Creator Platform",
  description: "Privacy-first creator subscriptions powered by Aleo. Subscribe anonymously, stream encrypted content, and own your experience.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${playfair.variable} ${inter.variable}`}>
      <body>
        <WalletProviders>
          <Navbar />
          <div className="page-shell">
            {children}
          </div>
        </WalletProviders>
      </body>
    </html>
  );
}
