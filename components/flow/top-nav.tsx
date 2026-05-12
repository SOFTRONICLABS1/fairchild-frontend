import Link from "next/link";

export default function TopNav({ right }: { right?: React.ReactNode }) {
  return (
    <div className="shell-nav">
      <Link href="/search" className="logo" aria-label="Go to landing page">
        <div className="logo-dot">P</div>
        Affiliate Autoposter
      </Link>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}

export function NavButton({ href, label }: { href: string; label: string }) {
  return (
    <Link className="btn-secondary" href={href}>
      {label}
    </Link>
  );
}
