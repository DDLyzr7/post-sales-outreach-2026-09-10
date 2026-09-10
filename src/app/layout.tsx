import type { Metadata } from "next";
import { DM_Mono, Figtree, Playfair_Display } from "next/font/google";
import "./globals.css";

// Lyzr brand type: Playfair Display for headings, Figtree for everything else.
const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"] });
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"] });
const dmMono = DM_Mono({ variable: "--font-dm-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Post-Sales Outreach",
  description: "Governed outbound communication to the existing client base.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${playfair.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
