import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Fiberise Fit – Operations Dashboard',
  description: 'Enterprise CRM for Fiberise Fit – Orders, Analytics, COD Remittance & Sales Intelligence',
  icons: {
    icon: '/favicon.ico',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* ── Inline script: apply theme & sidebar state BEFORE paint to prevent flash ── */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  // Theme: default to 'light' if no preference saved
                  var theme = localStorage.getItem('fiberise_theme') || 'light';
                  if (theme === 'dark') {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (e) {}

                try {
                  // Sidebar collapsed state
                  if (localStorage.getItem('sidebar_collapsed') === 'true') {
                    document.documentElement.setAttribute('data-sidebar-collapsed', 'true');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
