import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Shell } from "./components/Shell";
import { WalletProvider } from "../lib/wallet";
import "./globals.css";

/* The three voices. The font variables ride <html> so the tokens on :root
 * resolve — a sibling shipped them on <body> and every var() fell back. */
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600"],
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400"],
  display: "swap",
});
export const metadata: Metadata = {
  title: "Triggera — parametric insurance verification",
  description:
    "The policy defines the rules. Reality is investigated. Consensus settles the outcome.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <WalletProvider>
          <Shell>{children}</Shell>
        </WalletProvider>
      </body>
    </html>
  );
}
