import nodemailer from 'nodemailer'

/**
 * EmailService — Envía emails via SMTP de Hostinger.
 *
 * Usa las mismas credenciales que Papa por papa (documentadas en Obsidian).
 * Los emails van desde noreply@ctangarife.com con el nombre "HQ".
 */

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.hostinger.com'
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10)
const SMTP_USER = process.env.SMTP_USER || 'cristian@ctangarife.com'
const SMTP_PASS = process.env.SMTP_PASS || ''
const SMTP_FROM = process.env.SMTP_FROM || 'noreply@ctangarife.com'

function getTransporter(): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })
}

/**
 * Enviar email de invitación a workspace.
 */
export async function sendInvitationEmail(params: {
  to: string
  workspaceName: string
  invitedByName: string
  role: string
  registrationUrl: string
}): Promise<void> {
  const { to, workspaceName, invitedByName, role, registrationUrl } = params

  const roleLabels: Record<string, string> = {
    workspace_owner: 'Propietario',
    workspace_manager: 'Administrador',
    workspace_member: 'Miembro',
    workspace_viewer: 'Lector',
  }

  const html = `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0f1424; border-radius: 16px; color: #e2e8f0;">
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="font-size: 28px; font-weight: 700; color: #ffffff; margin: 0;">⬡ HQ</h1>
      <p style="color: #94a3b8; font-size: 14px; margin-top: 8px;">AI Agent Headquarters</p>
    </div>

    <div style="background: #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
      <h2 style="font-size: 20px; color: #ffffff; margin: 0 0 16px 0;">
        Te invitaron a ${workspaceName}
      </h2>
      <p style="font-size: 15px; line-height: 1.6; color: #cbd5e1; margin: 0 0 16px 0;">
        <strong>${invitedByName}</strong> te invitó como
        <span style="background: #3b82f6; color: white; padding: 2px 10px; border-radius: 999px; font-size: 13px; font-weight: 600;">
          ${roleLabels[role] || 'Miembro'}
        </span>
        al workspace <strong>${workspaceName}</strong> en HQ.
      </p>
      <p style="font-size: 14px; color: #94a3b8; margin: 0;">
        HQ es una plataforma de agentes IA que crea contenido para tu negocio:
        posts para redes sociales, reportes, investigación y más.
      </p>
    </div>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${registrationUrl}"
         style="display: inline-block; background: #3b82f6; color: white; font-size: 16px; font-weight: 600;
                padding: 14px 32px; border-radius: 10px; text-decoration: none;">
        Aceptar invitación →
      </a>
    </div>

    <p style="font-size: 13px; color: #64748b; text-align: center; margin-top: 24px;">
      Si el botón no funciona, copiá y pegá este link:<br>
      <a href="${registrationUrl}" style="color: #60a5fa; word-break: break-all;">${registrationUrl}</a>
    </p>

    <hr style="border: none; border-top: 1px solid #334155; margin: 32px 0;">

    <p style="font-size: 12px; color: #475569; text-align: center;">
      Esta invitación expira en 7 días. Si no esperabas este email, ignoralo.
    </p>
  </div>
  `

  const text = `
Te invitaron a ${workspaceName}

${invitedByName} te invitó como ${roleLabels[role] || 'Miembro'} al workspace ${workspaceName} en HQ.

Para aceptar, visitá:
${registrationUrl}

Esta invitación expira en 7 días.
  `.trim()

  await getTransporter().sendMail({
    from: `"HQ" <${SMTP_FROM}>`,
    to,
    subject: `⬡ Te invitaron a ${workspaceName} en HQ`,
    html,
    text,
  })
}

/**
 * Enviar email genérico (para futuras notificaciones).
 */
export async function sendEmail(params: {
  to: string
  subject: string
  html: string
  text?: string
  attachments?: Array<{
    filename: string
    content: Buffer
    contentType: string
  }>
}): Promise<void> {
  await getTransporter().sendMail({
    from: `"HQ" <${SMTP_FROM}>`,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text || '',
    attachments: params.attachments?.map(a => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  })
}
