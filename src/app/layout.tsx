import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { ServiceWorkerRegister } from './sw-register';

export const metadata: Metadata = {
  title: {
    default: 'WealthWise',
    template: '%s · WealthWise',
  },
  description:
    'Local-first personal finance tracker, EMI/debt payoff planner, and quantified advisor engine.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'WealthWise',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0B1220',
};

interface NavLink {
  href: string;
  label: string;
  icon: string;
}

const NAV_LINKS: NavLink[] = [
  { href: '/', label: 'Dashboard', icon: '\u{1F3E0}' },
  { href: '/transactions', label: 'Transactions', icon: '\u{1F4B8}' },
  { href: '/debt', label: 'Debt', icon: '\u{1F4C9}' },
  { href: '/insights', label: 'Insights', icon: '\u{1F4A1}' },
  { href: '/goals', label: 'Goals', icon: '\u{1F3AF}' },
  { href: '/connectors', label: 'Connectors', icon: '\u{1F50C}' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <ServiceWorkerRegister />
        <div className="app-shell">
          <aside className="side-nav" aria-label="Primary">
            <div className="side-nav-brand">WealthWise</div>
            <nav>
              <ul className="side-nav-list">
                {NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="side-nav-link">
                      <span aria-hidden="true">{link.icon}</span>
                      <span>{link.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <div className="app-main">
            <main className="app-content">{children}</main>

            <nav className="bottom-tab-bar" aria-label="Primary">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className="bottom-tab-link">
                  <span aria-hidden="true">{link.icon}</span>
                  <span>{link.label}</span>
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </body>
    </html>
  );
}
