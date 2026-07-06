// unsubscribe/index.js
const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

exports.unsubscribe = async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).send('Missing token');

  const snap = await db.collection('subscribers').where('unsubscribeToken', '==', token).limit(1).get();
  if (snap.empty) return res.status(404).send('User not found');

  await snap.docs[0].ref.update({ status: 'unsubscribed' });
  res.send('You have been unsubscribed.');
};