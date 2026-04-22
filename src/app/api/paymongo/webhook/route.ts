import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { adjustPoints, getUserProfile } from '@/lib/firestore'

function verifySignature(rawBody: string, sigHeader: string, secret: string): boolean {
  try {
    // sigHeader format:  t=<timestamp>,te=<test_sig>,li=<live_sig>
    const parts = Object.fromEntries(
      sigHeader.split(',').map(p => p.split('=') as [string, string])
    )
    const timestamp = parts['t']
    const testSig   = parts['te']
    const liveSig   = parts['li']

    const payload  = `${timestamp}.${rawBody}`
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')

    return expected === testSig || expected === liveSig
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[Webhook] PAYMONGO_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const rawBody   = await req.text()
  const sigHeader = req.headers.get('paymongo-signature') ?? ''

  if (!verifySignature(rawBody, sigHeader, webhookSecret)) {
    console.warn('[Webhook] Invalid signature — check PAYMONGO_WEBHOOK_SECRET in Vercel env')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = event?.data?.attributes?.type
  console.log('[Webhook] received event:', eventType)

  // ✅ Checkout Sessions fire THIS event (not link.payment.paid)
  if (eventType === 'checkout_session.payment.paid') {
    const sessionAttrs = event?.data?.attributes?.data?.attributes

    // ✅ Checkout Sessions use metadata (not remarks)
    const userId = sessionAttrs?.metadata?.userId as string | undefined
    const points = parseInt(sessionAttrs?.metadata?.points ?? '0', 10)

    console.log('[Webhook] metadata:', { userId, points })

    if (!userId || isNaN(points) || points <= 0) {
      console.warn('[Webhook] Missing or invalid metadata userId/points:', sessionAttrs?.metadata)
      return NextResponse.json({ ok: true })
    }

    try {
      const userProfile = await getUserProfile(userId)
      const userName    = userProfile?.name ?? 'Unknown'

      await adjustPoints(
        userId,
        points,
        `Purchased ${points} points via PayMongo`,
        'paymongo',
        'PayMongo',
        userName,
      )
      console.log(`[Webhook] ✅ Credited ${points} pts to ${userName} (${userId})`)
    } catch (err) {
      console.error('[Webhook] adjustPoints failed:', err)
      return NextResponse.json({ error: 'Failed to credit points' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}