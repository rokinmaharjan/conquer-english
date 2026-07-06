// send-daily-word/index.js
const { Firestore } = require('@google-cloud/firestore');
const formData = require('form-data');
const Mailgun = require('mailgun.js');

const db = new Firestore();

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY
});

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN; // e.g. "mg.yourdomain.com"

exports.sendDailyWord = async (event, context) => {
  // 1. Get the next unsent word
  const wordSnap = await db.collection('words')
    .where('sent', '==', false)
    .limit(1)
    .get();

  if (wordSnap.empty) {
    console.log('No unsent words left — resetting all words to unsent');
    const all = await db.collection('words').get();
    const batch = db.batch();
    all.forEach(doc => batch.update(doc.ref, { sent: false }));
    await batch.commit();
    return;
  }

  const wordDoc = wordSnap.docs[0];
  const { word, pos, meaning, example, audioUrl } = wordDoc.data();

  // 2. Get active subscribers
  const subsSnap = await db.collection('subscribers')
    .where('status', '==', 'active')
    .get();

  if (subsSnap.empty) {
    console.log('No active subscribers');
    await wordDoc.ref.update({ sent: true, sentAt: Firestore.FieldValue.serverTimestamp() });
    return;
  }

  const subscribers = subsSnap.docs.map(d => d.data());

  // 3. Mailgun batch sending: "to" can hold up to 1000 recipients per call,
  // with recipient-variables giving per-recipient substitution (like the unsubscribe link)
  const chunks = [];
  for (let i = 0; i < subscribers.length; i += 1000) {
    chunks.push(subscribers.slice(i, i + 1000));
  }

  for (const chunk of chunks) {
    const recipientVariables = {};
    chunk.forEach(sub => {
      recipientVariables[sub.email] = {
        unsubscribe_url: `https://us-central1-conquer-english-app.cloudfunctions.net/unsubscribe?token=${sub.unsubscribeToken}`
      };
    });

    const messageData = {
        from: 'Conquer English <words@rokin.com.np>',
        to: chunk.map(sub => sub.email),
        subject: `Word of the Day: ${word}`,
        html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Word of the Day: ${word}</title>
            </head>
            <body style="margin:0; padding:0; background-color:#FFF8EC; font-family:Helvetica, Arial, sans-serif;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF8EC;">
                <tr>
                <td align="center" style="padding:32px 16px; background-color:#FFF8EC;">
                    <table role="presentation" width="100%" style="max-width:480px;" cellpadding="0" cellspacing="0">

                    <!-- Logo -->
                    <tr>
                        <td align="center" style="padding-bottom:24px;">
                        <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                            <td style="background-color:#FF6F59; width:32px; height:32px; border-radius:8px; text-align:center; vertical-align:middle; font-family:Georgia, 'Times New Roman', serif; font-style:italic; font-weight:bold; font-size:17px; color:#FFF8EC;">
                                W
                            </td>
                            <td style="padding-left:10px; font-family:Georgia, 'Times New Roman', serif; font-weight:bold; font-size:18px; color:#241C3D;">
                                Word of the Day
                            </td>
                            </tr>
                        </table>
                        </td>
                    </tr>

                    <!-- Card -->
                    <tr>
                        <td style="background-color:#FFF1DA; border:2px solid #241C3D; border-radius:16px; padding:28px 26px;">

                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px dashed #E8CFA0; padding-bottom:12px;">
                            <tr>
                            <td style="font-size:11px; letter-spacing:0.5px; text-transform:uppercase; color:#5B5470; font-weight:bold; padding-bottom:12px;">
                                Today's word
                            </td>
                            </tr>
                        </table>

                        <div style="height:16px; line-height:16px; font-size:1px;">&nbsp;</div>
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                            <td style="font-family:Georgia, 'Times New Roman', serif; font-weight:bold; font-size:30px; color:#241C3D; line-height:1.1;">
                                ${word}
                            </td>
                            </tr>
                        </table>

                        <div style="height:14px; line-height:14px; font-size:1px;">&nbsp;</div>
                        <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                            <td style="background-color:#FFC145; color:#5A3E00; font-size:11px; font-weight:bold; letter-spacing:0.3px; padding:4px 12px; border-radius:100px;">
                                ${pos}
                            </td>
                            </tr>
                        </table>

                        ${audioUrl ? `
                        <div style="height:10px; line-height:10px; font-size:1px;">&nbsp;</div>
                        <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                            <td>
                                <a href="${audioUrl}" style="display:inline-block; background-color:#1FAFA0; color:#FFFFFF; text-decoration:none; font-size:12px; font-weight:bold; padding:7px 16px; border-radius:100px;">
                                &#9654; Hear it pronounced
                                </a>
                            </td>
                            </tr>
                        </table>
                        ` : ''}

                        <div style="height:16px; line-height:16px; font-size:1px;">&nbsp;</div>
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                            <td style="font-size:15px; line-height:1.55; color:#241C3D;">
                                ${meaning}
                            </td>
                            </tr>
                        </table>

                        <div style="height:18px; line-height:18px; font-size:1px;">&nbsp;</div>
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                            <td style="border-left:3px solid #FF6F59; padding-left:12px; font-family:Georgia, 'Times New Roman', serif; font-style:italic; font-size:15px; color:#5B5470; line-height:1.5;">
                                "${example}"
                            </td>
                            </tr>
                        </table>

                        </td>
                    </tr>

                    <tr>
                        <td align="center" style="padding:22px 12px 6px; font-size:13px; color:#5B5470;">
                        One good word. Every morning.
                        </td>
                    </tr>

                    <!-- Divider, then generous space before the legal/unsubscribe footer -->
                    <tr>
                        <td style="padding:0 12px;">
                        <div style="border-top:1px solid #E8CFA0;"></div>
                        </td>
                    </tr>

                    <tr>
                        <td align="center" style="padding:24px 12px 0; font-size:12px; color:#B9B3C9;">
                        You're receiving this because you subscribed at
                        <a href="https://rokin.com.np" style="color:#5B5470; text-decoration:underline;">rokin.com.np</a>.
                        </td>
                    </tr>

                    <tr>
                        <td align="center" style="padding:32px 12px 16px; font-size:12px;">
                        <a href="%recipient.unsubscribe_url%" style="color:#B9B3C9; text-decoration:underline;">Unsubscribe</a>
                        </td>
                    </tr>

                    </table>
                </td>
                </tr>
            </table>
            </body>
            </html>
        `,
        'recipient-variables': JSON.stringify(recipientVariables)
    };

    await mg.messages.create(MAILGUN_DOMAIN, messageData);
  }

  // 4. Mark word as sent
  await wordDoc.ref.update({ sent: true, sentAt: Firestore.FieldValue.serverTimestamp() });
  console.log(`Sent "${word}" to ${subscribers.length} subscribers`);
};