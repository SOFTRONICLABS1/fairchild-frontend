import "./globals.css";
import Providers from "@/lib/query/provider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Extensions (Google Tag Assistant, password managers, theme scripts) stamp attributes onto
  // <html> before React hydrates, which reads as a mismatch. suppressHydrationWarning applies
  // to this element only, so real mismatches inside the app still surface.
  return <html lang="en" suppressHydrationWarning><body><Providers>{children}</Providers></body></html>;
}
