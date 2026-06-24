import nodemailer from 'nodemailer'
import { getSmtpPrefsForAccount } from './user-profile-pg.mjs'
import { toEmailTitleCase } from './email-templates.mjs'

/**
 * @param {string | string[] | undefined} raw
 * @returns {string[] | undefined}
 */
export function parseEmailCcList(raw) {
  if (!raw) return undefined
  const parts = Array.isArray(raw) ? raw : String(raw).split(/[,;]+/)
  const list = parts.map((s) => String(s).trim()).filter(Boolean)
  return list.length ? list : undefined
}

/**
 * @param {ReturnType<import('./user-profile-pg.mjs').getSmtpPrefsForAccount> extends Promise<infer T> ? T : never} prefs
 */
function assertSmtpReady(prefs) {
  if (!prefs?.enabled) throw new Error('SMTP is not enabled')
  if (!prefs.host?.trim()) throw new Error('SMTP host is required')
  if (!prefs.notifyTo?.trim()) throw new Error('Notification email address is required')
  if (!prefs.fromEmail?.trim()) throw new Error('From email is required')
}

/**
 * @param {ReturnType<import('./user-profile-pg.mjs').getSmtpPrefsForAccount> extends Promise<infer T> ? T : never} prefs
 */
function createTransport(prefs) {
  const auth =
    prefs.user?.trim() && prefs.password
      ? { user: prefs.user.trim(), pass: prefs.password }
      : undefined
  return nodemailer.createTransport({
    host: prefs.host.trim(),
    port: prefs.port || 587,
    secure: prefs.secure === true,
    auth,
  })
}

/**
 * @param {string} accountKey
 * @param {{ subject: string, html: string, text?: string, cc?: string | string[], attachments?: import('nodemailer').SendMailOptions['attachments'] }} mail
 */
export async function sendEmailForAccount(accountKey, mail) {
  const prefs = await getSmtpPrefsForAccount(accountKey)
  assertSmtpReady(prefs)
  const transport = createTransport(prefs)
  const fromName = prefs.fromName?.trim() || 'TripBuddy'
  const from = `"${fromName.replace(/"/g, '')}" <${prefs.fromEmail.trim()}>`
  const cc = parseEmailCcList(mail.cc)
  await transport.sendMail({
    from,
    to: prefs.notifyTo.trim(),
    ...(cc ? { cc } : {}),
    subject: mail.subject,
    html: mail.html,
    text: mail.text || stripHtml(mail.html),
    attachments: mail.attachments,
  })
  return { ok: true, to: prefs.notifyTo.trim(), cc: cc || [] }
}

/**
 * @param {string} accountKey
 */
export async function sendSmtpTestEmail(accountKey) {
  const prefs = await getSmtpPrefsForAccount(accountKey)
  assertSmtpReady(prefs)
  const { wrapEmailHtml } = await import('./email-templates.mjs')
  const html = wrapEmailHtml({
    title: 'SMTP test successful',
    preheader: 'TripBuddy email is configured',
    bodyHtml: `<p style="margin:0;font-size:16px;line-height:1.55;">Your TripBuddy SMTP settings are working. You will receive trip alerts and shift summaries at this address.</p>`,
  })
  return sendEmailForAccount(accountKey, {
    subject: toEmailTitleCase('TripBuddy — SMTP test'),
    html,
    text: 'TripBuddy SMTP test successful.',
  })
}

/** @param {string} html */
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
