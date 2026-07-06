// upload-words.js
// Uploads all 365 words from words-data.js into the Firestore "words" collection.
// Each document gets: word, pos, meaning, example, sent (false), audioUrl (null placeholder)
//
// Run with: node upload-words.js
// Requires: npm install @google-cloud/firestore
// Auth: uses Application Default Credentials — run `gcloud auth application-default login` first
//       if running this locally (not from inside a Cloud Function).

const { Firestore } = require('@google-cloud/firestore');
const words = require('./words-data-advanced.js');

const db = new Firestore();
const BATCH_LIMIT = 450; // Firestore batch writes cap at 500 operations; staying under that

async function uploadWords() {
  console.log(`Preparing to upload ${words.length} words...`);

  let uploaded = 0;
  for (let i = 0; i < words.length; i += BATCH_LIMIT) {
    const chunk = words.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();

    for (const entry of chunk) {
      const ref = db.collection('words').doc(); // auto-generated ID
      batch.set(ref, {
        word: entry.word,
        pos: entry.pos,
        meaning: entry.meaning,
        example: entry.example,
        sent: false,
        audioUrl: null,
        createdAt: Firestore.FieldValue.serverTimestamp()
      });
    }

    await batch.commit();
    uploaded += chunk.length;
    console.log(`Uploaded ${uploaded} / ${words.length}...`);
  }

  console.log('Done. All words uploaded to Firestore.');
}

uploadWords().catch(err => {
  console.error('Upload failed:', err);
  process.exit(1);
});
