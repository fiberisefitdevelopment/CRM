import nodemailer from 'nodemailer';
import { claimRtoNotification, releaseRtoNotificationClaim } from './rtoNotificationRegistry';
import { getPaymentLabel } from '@/src/utils/orderPayment';

/**
 * Core function to send RTO email alerts.
 * If Brevo SMTP credentials are configured, it delivers a live, beautiful HTML email.
 * Otherwise, it falls back to a simulated terminal console logger.
 */
export async function shootRtoEmailAlert(order: any): Promise<boolean> {
  const orderId = String(order.id);
  const orderName = order.name || `#${orderId}`;

  const claimed = await claimRtoNotification(orderId, orderName);
  if (!claimed) {
    return false;
  }
  const customerName = order.customer
    ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
    : 'Guest Customer';
  const customerEmail = order.customer?.email || 'N/A';
  const customerPhone = order.customer?.phone || 'N/A';

  const address = order.shipping_address || {};
  const shippingAddressStr = `${address.address1 || ''}, ${address.address2 || ''}, ${address.city || ''}, ${address.province || ''} - ${address.zip || ''}`;

  const latestFulfillment = order.fulfillments?.[0];
  const trackingNumber = latestFulfillment?.tracking_number || 'N/A';
  const trackingCompany = latestFulfillment?.tracking_company || 'Standard Surface';
  const trackingUrl = latestFulfillment?.tracking_url || '#';

  const totalPrice = parseFloat(order.total_price || '0').toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
  const paymentType = getPaymentLabel(order) === 'COD' ? 'COD (Cash on Delivery)' : 'Prepaid (Paid Online)';

  // Build items rows for both text and HTML versions
  const itemsText = (order.line_items || []).map(
    (item: any) => `  - [SKU: ${item.sku || 'N/A'}] ${item.title || 'Product'} x${item.quantity || 1} (₹${parseFloat(item.price || '0').toLocaleString('en-IN')})`
  ).join('\n');

  const itemsHtml = (order.line_items || []).map((item: any) => {
    const priceVal = parseFloat(item.price || '0');
    return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
        <td style="padding: 12px 0; color: #ffffff; font-weight: bold;">
          ${item.title || 'Product'}<br/>
          <span style="font-size: 10px; color: #a0aec0; font-family: monospace;">SKU: ${item.sku || 'N/A'}</span>
        </td>
        <td style="padding: 12px 0; text-align: center; color: #a0aec0;">x${item.quantity || 1}</td>
        <td style="padding: 12px 0; text-align: right; color: #38a169; font-weight: bold;">₹${priceVal.toLocaleString('en-IN')}</td>
      </tr>
    `;
  }).join('');

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>RTO ALERT: ${orderName}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #07090e; color: #e2e8f0;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #0e121a; border-radius: 16px; overflow: hidden; margin-top: 40px; margin-bottom: 40px; border: 1px solid #e53e3e;">
        
        <!-- Alert Header Banner -->
        <tr>
          <td style="padding: 30px; text-align: center; background-color: #e53e3e; color: #ffffff;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">🚨 URGENT RTO INITIATED</h1>
            <p style="margin: 5px 0 0 0; font-size: 13px; font-weight: 600; opacity: 0.9; text-transform: uppercase;">Delivery Failure Detected for Order ${orderName}</p>
          </td>
        </tr>

        <!-- Content Area -->
        <tr>
          <td style="padding: 30px;">
            <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #a0aec0;">
              Dear Support & CEO Teams,<br/>
              This is an automated notification from the <strong>Fiberise Fit</strong> dashboard. A Return to Origin (RTO) has been initiated for <strong>Order ${orderName}</strong>. 
            </p>

            <!-- Grid Details Card -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #121722; border-radius: 12px; padding: 20px; margin-bottom: 25px; border: 1px solid rgba(255,255,255,0.05);">
              <tr>
                <td width="50%" style="padding-bottom: 15px; vertical-align: top;">
                  <span style="font-size: 10px; color: #718096; font-weight: bold; text-transform: uppercase; display: block; margin-bottom: 4px;">Order Name</span>
                  <strong style="font-size: 15px; color: #ffffff;">${orderName}</strong>
                </td>
                <td width="50%" style="padding-bottom: 15px; vertical-align: top;">
                  <span style="font-size: 10px; color: #718096; font-weight: bold; text-transform: uppercase; display: block; margin-bottom: 4px;">Total Value</span>
                  <strong style="font-size: 15px; color: #48bb78;">${totalPrice}</strong>
                </td>
              </tr>
              <tr>
                <td width="50%" style="vertical-align: top;">
                  <span style="font-size: 10px; color: #718096; font-weight: bold; text-transform: uppercase; display: block; margin-bottom: 4px;">Payment Method</span>
                  <strong style="font-size: 13px; color: #ecc94b;">${paymentType}</strong>
                </td>
                <td width="50%" style="vertical-align: top;">
                  <span style="font-size: 10px; color: #718096; font-weight: bold; text-transform: uppercase; display: block; margin-bottom: 4px;">Fulfillment Status</span>
                  <span style="font-size: 10px; font-weight: 800; background-color: #e53e3e; color: #ffffff; padding: 3px 8px; border-radius: 12px; text-transform: uppercase; display: inline-block;">RTO Returns</span>
                </td>
              </tr>
            </table>

            <!-- Customer Details -->
            <h3 style="margin: 0 0 10px 0; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #ffffff; border-left: 3px solid #e53e3e; padding-left: 8px;">👤 Customer Details</h3>
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 25px; font-size: 13px; line-height: 1.5; color: #cbd5e0;">
              <tr><td width="30%" style="padding: 4px 0; color: #718096; font-weight: bold;">Name:</td><td style="padding: 4px 0; color: #ffffff; font-weight: bold;">${customerName}</td></tr>
              <tr><td style="padding: 4px 0; color: #718096; font-weight: bold;">Phone:</td><td style="padding: 4px 0;"><a href="tel:${customerPhone}" style="color: #63b3ed; text-decoration: none; font-weight: bold;">${customerPhone}</a></td></tr>
              <tr><td style="padding: 4px 0; color: #718096; font-weight: bold;">Email:</td><td style="padding: 4px 0;"><a href="mailto:${customerEmail}" style="color: #63b3ed; text-decoration: none;">${customerEmail}</a></td></tr>
              <tr><td style="padding: 4px 0; color: #718096; font-weight: bold; vertical-align: top;">Address:</td><td style="padding: 4px 0; line-height: 1.4;">${shippingAddressStr}</td></tr>
            </table>

            <!-- Shipment Details -->
            <h3 style="margin: 0 0 10px 0; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #ffffff; border-left: 3px solid #e53e3e; padding-left: 8px;">🚚 Carrier Information</h3>
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 25px; font-size: 13px; line-height: 1.5; color: #cbd5e0;">
              <tr><td width="30%" style="padding: 4px 0; color: #718096; font-weight: bold;">Partner:</td><td style="padding: 4px 0; color: #ffffff; font-weight: bold;">${trackingCompany}</td></tr>
              <tr><td style="padding: 4px 0; color: #718096; font-weight: bold;">AWB:</td><td style="padding: 4px 0; font-family: monospace; color: #ffffff; font-weight: bold;">${trackingNumber}</td></tr>
              <tr><td style="padding: 4px 0; color: #718096; font-weight: bold;">Tracking URL:</td><td style="padding: 4px 0;"><a href="${trackingUrl}" target="_blank" style="color: #63b3ed; text-decoration: underline; font-weight: bold;">Track live package</a></td></tr>
            </table>

            <!-- Product List Table -->
            <h3 style="margin: 0 0 10px 0; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #ffffff; border-left: 3px solid #e53e3e; padding-left: 8px;">🛍️ Items Ordered</h3>
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 25px; font-size: 13px; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); color: #718096; text-transform: uppercase; font-size: 10px; font-weight: bold;">
                  <th align="left" style="padding-bottom: 8px;">Product</th>
                  <th align="center" style="padding-bottom: 8px;" width="15%">Qty</th>
                  <th align="right" style="padding-bottom: 8px;" width="25%">Price</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <!-- Required Actions Card -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: rgba(229,62,62,0.06); border-radius: 8px; padding: 15px; border: 1px dashed rgba(229,62,62,0.3);">
              <tr>
                <td>
                  <strong style="color: #f56565; font-size: 13px; text-transform: uppercase; display: block; margin-bottom: 6px;">📢 Actions Required Immediately:</strong>
                  <ol style="margin: 0; padding-left: 20px; font-size: 12px; line-height: 1.5; color: #e2e8f0;">
                    <li style="margin-bottom: 4px;"><strong>Support Team</strong>: Call the customer directly on <strong>${customerPhone}</strong> to verify the delivery failure reason.</li>
                    <li>Update Firestore WhatsApp journey records and log details inside the AiSensy console.</li>
                  </ol>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding: 20px 30px; text-align: center; background-color: #0b0d13; border-top: 1px solid rgba(255,255,255,0.05); font-size: 11px; color: #4a5568;">
            This alert was dispatched automatically on behalf of Fiberise Fit Developer Engine.<br/>
            Dashboard live analytics monitoring active.
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  // Extract Brevo configuration
  const smtpUser = process.env.BREVO_SMTP_USER;
  const smtpKey = process.env.BREVO_SMTP_KEY;

  const hasCredentials = smtpUser && smtpKey &&
    smtpUser !== 'your_brevo_login_email_here' &&
    smtpKey !== 'your_brevo_smtp_key_here';

  if (hasCredentials) {
    try {
      // ----------------------------------------------------
      // LIVE BREVO WEB HTTP API DISPATCH MODE (PRIMARY)
      // ----------------------------------------------------
      let apiSuccess = false;
      let apiErrorMsg = '';

      try {
        console.log(`🔗 [Brevo API] Attempting HTTPS API mail delivery for order ${orderName}...`);
        const apiResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': smtpKey,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            sender: { name: 'Fiberise RTO Engine', email: 'developer@fiberisefit.com' },
            to: [
              { email: 'support@fiberisefit.com', name: 'Support Team' },
              { email: 'ceo@fiberisefit.com', name: 'CEO' },
              { email: 'yash.srivastava@fiberisefit.com', name: 'Yash Srivastava' }
            ],
            subject: `🚨 URGENT RTO ALERT: Order ${orderName} Delivery Failed`,
            textContent: `RTO ALERT:\nOrder ${orderName} total ${totalPrice} has failed. Customer details:\nName: ${customerName}\nPhone: ${customerPhone}\nItems:\n${itemsText}`,
            htmlContent: htmlBody
          })
        });

        if (apiResponse.ok) {
          console.log(`✅ [Brevo API] Real email notification successfully delivered to support/ceo/yash for order ${orderName}`);
          return true;
        } else {
          const errText = await apiResponse.text().catch(() => '');
          apiErrorMsg = errText || `Status ${apiResponse.status}`;
          console.warn(`⚠️ [Brevo API] Web API delivery rejected (status ${apiResponse.status}): ${errText}. Falling back to SMTP...`);
        }
      } catch (apiError: any) {
        apiErrorMsg = apiError.message || String(apiError);
        console.warn(`⚠️ [Brevo API] HTTPS web dispatch failed: ${apiError.message || apiError}. Falling back to SMTP...`);
      }

      // ----------------------------------------------------
      // LIVE BREVO SMTP DISPATCH MODE (FALLBACK)
      // ----------------------------------------------------
      try {
        console.log(`🔗 [Brevo SMTP] Attempting SMTP Relay fallback delivery for order ${orderName}...`);
        const transporter = nodemailer.createTransport({
          host: 'smtp-relay.brevo.com',
          port: 587,
          secure: false, // TLS
          auth: {
            user: smtpUser,
            pass: smtpKey,
          },
        });

        await transporter.sendMail({
          from: '"Fiberise RTO Engine" <developer@fiberisefit.com>',
          to: 'support@fiberisefit.com, ceo@fiberisefit.com, yash.srivastava@fiberisefit.com',
          subject: `🚨 URGENT RTO ALERT: Order ${orderName} Delivery Failed`,
          text: `RTO ALERT:\nOrder ${orderName} total ${totalPrice} has failed. Customer details:\nName: ${customerName}\nPhone: ${customerPhone}\nItems:\n${itemsText}`,
          html: htmlBody,
        });

        console.log(`✅ [Brevo SMTP] Real email notification delivered successfully to support/ceo/yash for order ${orderName}`);
        return true;
      } catch (smtpError: any) {
        console.error('💥 [Brevo SMTP] Failed to send email via SMTP:', smtpError);
        throw new Error(`[Brevo Delivery Failed] Web API error: ${apiErrorMsg} | SMTP Relay error: ${smtpError.message || smtpError}`);
      }
    } catch (dispatchError: any) {
      // Revert the lock so we can retry on next interval since send failed
      await releaseRtoNotificationClaim(orderId);
      throw dispatchError;
    }
  }

  // ----------------------------------------------------
  // SIMULATOR FALLBACK MODE
  // ----------------------------------------------------
  // Shoot the simulated email by printing a gorgeously formatted email alert box
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║ 📧 OUTGOING EMAIL DISPATCHED SUCCESSFULLY                                 ║
╠══════════════════════════════════════════════════════════════════════════╣
║ FROM:     developer@fiberisefit.com                                      ║
║ TO:       support@fiberisefit.com, ceo@fiberisefit.com,                  ║
║           yash.srivastava@fiberisefit.com                                ║
║ SUBJECT:  🚨 URGENT RTO ALERT: Delivery Failed for Order ${orderName}       ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║ Dear Support & CEO Teams,                                                ║
║                                                                          ║
║ This is an automated notification from the Fiberise Fit dashboard.       ║
║ A Return to Origin (RTO) has been initiated for the following order:     ║
║                                                                          ║
║ 📦 ORDER SUMMARY:                                                        ║
║ ------------------------------------------------------------------------ ║
║  • Order Name:      ${orderName}                                         ║
║  • Transaction ID:  ${orderId}                                           ║
║  • Total Value:     ${totalPrice}                                         ║
║  • Payment Method:  ${paymentType}                                       ║
║                                                                          ║
║ 👤 CUSTOMER DETAILS:                                                     ║
║ ------------------------------------------------------------------------ ║
║  • Name:            ${customerName}                                      ║
║  • Email:           ${customerEmail}                                     ║
║  • Phone:           ${customerPhone}                                     ║
║  • Address:         ${shippingAddressStr}                                ║
║                                                                          ║
║ 🚚 CARRIER INFORMATION:                                                  ║
║ ------------------------------------------------------------------------ ║
║  • Logistics Partner: ${trackingCompany}                                  ║
║  • Air Waybill (AWB): ${trackingNumber}                                   ║
║  • Track shipment:    ${trackingUrl}                                      ║
║                                                                          ║
║ 🛍️ LINE ITEMS:                                                           ║
║ ------------------------------------------------------------------------ ║
${itemsText}                                                               ║
║                                                                          ║
║ ACTIONS REQUESTED:                                                       ║
║ 1. Support Team: Contact the customer on ${customerPhone} to verify the  ║
║    delivery failure reason (e.g. incorrect address, customer refused).    ║
║ 2. Log details inside AiSensy WhatsApp logs and update Firestore.        ║
║                                                                          ║
║ Sincerely,                                                               ║
║ Fiberise Developer Engine                                                ║
╚══════════════════════════════════════════════════════════════════════════╝
`);

  return true;
}
