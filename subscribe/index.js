const { Firestore } = require('@google-cloud/firestore');
const { v4: uuidv4 } = require('uuid');

const db = new Firestore();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.subscribe = async (req, res) => {
  res.set('Access-Control-Allow-Origin', 'https://rokin.com.np'); 
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).send('');
  }

  const email = (req.body.email || '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const ref = db.collection('subscribers').doc(email);
  const doc = await ref.get();

  if (doc.exists && doc.data().status === 'active') {
    return res.status(200).json({ message: 'Already subscribed' });
  }

  await ref.set({
    email,
    status: 'active',
    unsubscribeToken: uuidv4(),
    subscribedAt: Firestore.FieldValue.serverTimestamp()
  });

  return res.status(200).json({ message: 'Subscribed successfully' });
};