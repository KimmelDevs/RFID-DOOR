import {
  collection, doc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, onSnapshot, query,
  orderBy, serverTimestamp, increment, addDoc,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'

export interface UserProfile {
  uid: string
  email: string
  name: string
  role: 'admin' | 'user'
  points: number
  cardUid?: string
  createdAt: Timestamp | null
}

export interface Transaction {
  id?: string
  userId: string
  userName: string
  type: 'credit' | 'debit'
  amount: number
  reason: string
  adminId: string
  adminName: string
  createdAt: Timestamp | null
}

// ── Users ───────────────────────────────────────────────────────────────────

export const createUserProfile = async (uid: string, data: Omit<UserProfile, 'uid'>) => {
  await setDoc(doc(db, 'users', uid), { ...data, uid })
}

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? (snap.data() as UserProfile) : null
}

export const updateUserProfile = async (uid: string, data: Partial<UserProfile>) => {
  await updateDoc(doc(db, 'users', uid), data)
}

export const deleteUserProfile = async (uid: string) => {
  await deleteDoc(doc(db, 'users', uid))
}

export const getAllUsers = async (): Promise<UserProfile[]> => {
  const snap = await getDocs(collection(db, 'users'))
  return snap.docs.map(d => d.data() as UserProfile)
}

export const listenAllUsers = (cb: (users: UserProfile[]) => void) => {
  return onSnapshot(collection(db, 'users'), snap => {
    cb(snap.docs.map(d => d.data() as UserProfile))
  })
}

export const listenUser = (uid: string, cb: (u: UserProfile | null) => void) => {
  return onSnapshot(doc(db, 'users', uid), snap => {
    cb(snap.exists() ? (snap.data() as UserProfile) : null)
  })
}

// ── Points ──────────────────────────────────────────────────────────────────

export const adjustPoints = async (
  userId: string,
  amount: number,
  reason: string,
  adminId: string,
  adminName: string,
  userName: string,
) => {
  const userRef = doc(db, 'users', userId)
  await updateDoc(userRef, { points: increment(amount) })

  const tx: Omit<Transaction, 'id'> = {
    userId,
    userName,
    type: amount >= 0 ? 'credit' : 'debit',
    amount: Math.abs(amount),
    reason,
    adminId,
    adminName,
    createdAt: serverTimestamp() as Timestamp,
  }
  await addDoc(collection(db, 'transactions'), tx)
}

export const listenTransactions = (cb: (txs: Transaction[]) => void) => {
  const q = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'))
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)))
  })
}

export const listenUserTransactions = (userId: string, cb: (txs: Transaction[]) => void) => {
  const q = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'))
  return onSnapshot(q, snap => {
    const txs = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as Transaction))
      .filter(t => t.userId === userId)
    cb(txs)
  })
}

export const findUserByCardUid = async (cardUid: string): Promise<UserProfile | null> => {
  const snap = await getDocs(collection(db, 'users'))
  const match = snap.docs.find(d => d.data().cardUid === cardUid.toUpperCase())
  return match ? (match.data() as UserProfile) : null
}