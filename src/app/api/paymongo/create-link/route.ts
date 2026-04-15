import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { userId, userName, points, amountCents } = await req.json()

    if (!userId || !points || !amountCents) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '')
    const secretKey = process.env.PAYMONGO_SECRET_KEY

    if (!secretKey) {
      return NextResponse.json({ error: 'PayMongo not configured' }, { status: 500 })
    }

    const auth = Buffer.from(`${secretKey}:`).toString('base64')

    const body = {
      data: {
        attributes: {
          amount: amountCents,           // in centavos (e.g. 5000 = ₱50.00)
          currency: 'PHP',
          description: `${points} points for ${userName ?? 'user'}`,
          remarks: `userId:${userId}|points:${points}`,
          redirect: {
            success: `${baseUrl}/dashboard?payment=success&points=${points}`,
            failed:  `${baseUrl}/dashboard?payment=failed`,
          },
        },
      },
    }

    const pmRes = await fetch('https://api.paymongo.com/v1/links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    })

    const pmData = await pmRes.json()

    if (!pmRes.ok) {
      console.error('[PayMongo] create-link error:', pmData)
      return NextResponse.json({ error: pmData?.errors?.[0]?.detail ?? 'PayMongo error' }, { status: 500 })
    }

    const checkoutUrl = pmData.data?.attributes?.checkout_url
    const linkId      = pmData.data?.id

    return NextResponse.json({ checkoutUrl, linkId })
  } catch (err) {
    console.error('[PayMongo] create-link exception:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
