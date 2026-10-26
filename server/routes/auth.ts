import { Router, type Request } from 'express'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  SESSION_COOKIE,
  createSession,
  getGoogleConfig,
  isGoogleEnabled,
  isOwnerEmail,
  sessionCookieOptions,
} from '../auth'

const OAUTH_STATE_COOKIE = 'brain_oauth_state'
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

const router = Router()

function redirectUri(req: Request): string {
  const configured = (process.env.GOOGLE_REDIRECT_URI || '').trim()
  if (configured) return configured
  return `${req.protocol}://${req.get('host')}/api/auth/google/callback`
}

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function fail(message: string) {
  return `/login?error=${encodeURIComponent(message)}`
}

router.get('/google', (req, res) => {
  if (!isGoogleEnabled()) {
    res.redirect(fail('google_not_configured'))
    return
  }

  const { clientId } = getGoogleConfig()
  const state = randomBytes(24).toString('hex')
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/api/auth/google',
    maxAge: OAUTH_STATE_TTL_MS,
  })

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
})

router.get('/google/callback', async (req, res) => {
  if (!isGoogleEnabled()) {
    res.redirect(fail('google_not_configured'))
    return
  }

  const { clientId, clientSecret, ownerEmail } = getGoogleConfig()
  const state = typeof req.query.state === 'string' ? req.query.state : ''
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  const expectedState = req.cookies?.[OAUTH_STATE_COOKIE]
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/auth/google' })

  if (typeof req.query.error === 'string') {
    res.redirect(fail('google_denied'))
    return
  }
  if (!state || !expectedState || !sameState(state, String(expectedState))) {
    res.redirect(fail('google_state'))
    return
  }
  if (!code) {
    res.redirect(fail('google_failed'))
    return
  }
  if (!ownerEmail) {
    res.redirect(fail('google_owner'))
    return
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenResponse.ok) {
      const details = (await tokenResponse.json().catch(() => null)) as { error?: string } | null
      console.error(`[auth] google token: ${tokenResponse.status} ${details?.error || ''}`.trim())
      res.redirect(fail('google_failed'))
      return
    }

    const tokens = (await tokenResponse.json()) as { access_token?: string }
    if (!tokens.access_token) {
      res.redirect(fail('google_failed'))
      return
    }

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!profileResponse.ok) {
      res.redirect(fail('google_failed'))
      return
    }

    const profile = (await profileResponse.json()) as {
      email?: string
      email_verified?: boolean | string
    }
    const email = (profile.email || '').trim()
    const verified = profile.email_verified === true || profile.email_verified === 'true'
    if (!email || !verified) {
      res.redirect(fail('google_email'))
      return
    }
    if (!isOwnerEmail(email)) {
      res.redirect(fail('google_denied'))
      return
    }

    res.cookie(SESSION_COOKIE, createSession(), sessionCookieOptions(req))
    res.redirect('/')
  } catch (error) {
    console.error('[auth] google:', error instanceof Error ? error.message : error)
    res.redirect(fail('google_failed'))
  }
})

export default router
