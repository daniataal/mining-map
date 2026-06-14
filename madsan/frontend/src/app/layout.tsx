import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

export const metadata: Metadata = {
  title: "MadSan Intelligence",
  description: "Commodity intelligence terminal — discover, verify, price, execute",
  icons: {
    icon: "/assets/brand/madsan-logo.png",
    apple: "/assets/brand/madsan-logo.png",
  },
};

const themeInitScript = `(function(){try{var t=localStorage.getItem("madsan-theme");document.documentElement.classList.add(t==="light"?"light":"dark");}catch(e){document.documentElement.classList.add("dark");}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
