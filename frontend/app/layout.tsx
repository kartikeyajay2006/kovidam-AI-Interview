import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kovidam AI Interview Platform",
  description: "Production-grade AI Interview and Candidate Evaluation Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
