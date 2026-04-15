import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { adjustPoints, getUserProfile } from '@/lib/firestore'

// PayMongo sends events as POST with a signature header
// Docs: https://developers.paymongo.com/docs/webhooks

function verifySignature(rawBody: string, sigHeader: string, secret: string): boolean {
  try {
    // sigHeader format:  t=<timestamp>,te=<test_sig>,li=<live_sig>
    const parts = Object.fromEntries(
      sigHeader.split(',').map(p => p.split('=') as [string, string])
    )
    const timestamp = parts['t']
    const testSig   = parts['te']
    const liveSig   = parts['li']

    const payload = `${timestamp}.${rawBody}`
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')

    return expected === testSig || expected === liveSig
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET

  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const sigHeader = req.headers.get('paymongo-signature') ?? ''

  if (!verifySignature(rawBody, sigHeader, webhookSecret)) {
    console.warn('[PayMongo Webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = event?.data?.attributes?.type

  // We only care about successful link payments
  if (eventType === 'link.payment.paid') {
    const linkData = event?.data?.attributes?.data
    const remarks  = linkData?.attributes?.remarks as string | undefined

    // remarks format: "userId:<uid>|points:<n>"
    if (!remarks) {
      console.warn('[PayMongo Webhook] Missing remarks on paid link')
      return NextResponse.json({ ok: true })
    }

    const match = remarks.match(/userId:([^|]+)\|points:(\d+)/)
    if (!match) {
      console.warn('[PayMongo Webhook] Could not parse remarks:', remarks)
      return NextResponse.json({ ok: true })
    }

    const userId = match[1]
    const points = parseInt(match[2], 10)

    if (!userId || isNaN(points) || points <= 0) {
      console.warn('[PayMongo Webhook] Invalid userId or points')
      return NextResponse.json({ ok: true })
    }

    try {
      const userProfile = await getUserProfile(userId)
      const userName = userProfile?.name ?? 'Unknown'

      await adjustPoints(
        userId,
        points,
        `Purchased ${points} points via PayMongo`,
        'paymongo',
        'PayMongo',
        userName,
      )
      console.log(`[PayMongo Webhook] Credited ${points} pts to ${userName} (${userId})`)
    } catch (err) {
      console.error('[PayMongo Webhook] adjustPoints failed:', err)
      return NextResponse.json({ error: 'Failed to credit points' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
