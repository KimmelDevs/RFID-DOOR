'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut as fbSignOut,
  User,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { getUserProfile, createUserProfile, UserProfile } from '@/lib/firestore'
import { serverTimestamp } from 'firebase/firestore'

interface AuthCtx {
  user:    User | null
  profile: UserProfile | null
  loading: boolean
  signIn:  (email: string, password: string) => Promise<void>
  signUp:  (email: string, password: string, name: string) => Promise<void>
  signOut: () => Promise<void>
}

const Context = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, async u => {
      setUser(u)
      if (u) {
        const p = await getUserProfile(u.uid)
        setProfile(p)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })
  }, [])

  const signIn = async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    const p = await getUserProfile(cred.user.uid)
    setProfile(p)
  }

  const signUp = async (email: string, password: string, name: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    const newProfile: Omit<UserProfile, 'uid'> = {
      email,
      name,
      role: 'user',
      points: 0,
      createdAt: null,
    }
    await createUserProfile(cred.user.uid, newProfile)
    setProfile({ ...newProfile, uid: cred.user.uid })
  }

  const signOut = async () => {
    await fbSignOut(auth)
    setUser(null)
    setProfile(null)
  }

  return (
    <Context.Provider value={{ user, profile, loading, signIn, signUp, signOut }}>
      {children}
    </Context.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(Context)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
