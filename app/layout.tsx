import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ContextOS",
  description: "Futuristic multi-agent runtime dashboard (mock demo)"
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

