import "./globals.css";
import Providers from "@/lib/query/provider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
