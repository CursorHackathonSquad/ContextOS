import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OsanoAI",
  description: "Multi-agent runtime dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="cosmos" />
        {children}
      </body>
    </html>
  );
}

