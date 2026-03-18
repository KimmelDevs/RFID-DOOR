import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/hooks/useAuth'

export const metadata: Metadata = {
  title: 'RFID Door Control',
  description: 'Smart door access management with MQTT & Firebase',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="scanline" />
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
