'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

export default function RootPage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!user)                     router.replace('/login')
    else if (profile?.role === 'admin') router.replace('/admin')
    else                           router.replace('/dashboard')
  }, [user, profile, loading, router])

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-muted text-sm font-mono">Initializing…</p>
      </div>
    </div>
  )
}
