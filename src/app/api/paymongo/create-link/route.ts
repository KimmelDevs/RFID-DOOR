import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { userId, userName, points, amountCents } = await req.json()

    if (!userId || !points || !amountCents) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const baseUrl    = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '')
    const secretKey  = process.env.PAYMONGO_SECRET_KEY

    if (!secretKey) {
      return NextResponse.json({ error: 'PayMongo not configured' }, { status: 500 })
    }

    const auth = Buffer.from(`${secretKey}:`).toString('base64')

    const body = {
      data: {
        attributes: {
          billing: {
            name: userName ?? 'Customer',
          },
          line_items: [
            {
              currency:   'PHP',
              amount:     amountCents,           // centavos e.g. 10000 = ₱100
              name:       `${points} Cool Kids Club Points`,
              quantity:   1,
            },
          ],
          payment_method_types: ['gcash', 'card'],   // ← GCash + Credit Card
          success_url: `${baseUrl}/dashboard?payment=success&points=${points}`,
          cancel_url:  `${baseUrl}/dashboard?payment=failed`,
          metadata: {
            userId,
            points: String(points),
          },
          description: `${points} pts for ${userName ?? 'user'}`,
          send_email_receipt: false,
        },
      },
    }

    const pmRes = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    })

    const pmData = await pmRes.json()

    if (!pmRes.ok) {
      console.error('[PayMongo] checkout_session error:', pmData)
      return NextResponse.json(
        { error: pmData?.errors?.[0]?.detail ?? 'PayMongo error' },
        { status: 500 }
      )
    }

    const checkoutUrl = pmData.data?.attributes?.checkout_url
    const linkId      = pmData.data?.id

    return NextResponse.json({ checkoutUrl, linkId })
  } catch (err) {
    console.error('[PayMongo] checkout_session exception:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}