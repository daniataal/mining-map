import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MadSan Intelligence",
  description: "Commodity intelligence terminal — discover, verify, price, execute",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
