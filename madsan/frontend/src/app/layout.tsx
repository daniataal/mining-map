import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";

export const metadata: Metadata = {
  title: "MadSan Intelligence",
  description: "Commodity intelligence terminal — discover, verify, price, execute",
  icons: {
    icon: "/assets/brand/madsan-logo.png",
    apple: "/assets/brand/madsan-logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
