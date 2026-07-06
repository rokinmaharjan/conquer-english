// generate-audio.js
// For every word in Firestore missing an audioUrl, synthesizes a pronunciation
// clip via Google Cloud Text-to-Speech, uploads it to Cloud Storage, and saves
// the public URL back onto the Firestore document.
//
// Run with: node generate-audio.js
// Requires: npm install @google-cloud/firestore @google-cloud/text-to-speech @google-cloud/storage
// Auth: uses Application Default Credentials — run `gcloud auth application-default login` first
//       if running this locally.
//
// Before running:
//   gcloud services enable texttospeech.googleapis.com
//   gcloud storage buckets create gs://conquer-english-app-audio --location=us-central1 --uniform-bucket-level-access
//   gcloud storage buckets add-iam-policy-binding gs://conquer-english-app-audio --member=allUsers --role=roles/storage.objectViewer

const { Firestore } = require('@google-cloud/firestore');
const textToSpeech = require('@google-cloud/text-to-speech');
const { Storage } = require('@google-cloud/storage');

const db = new Firestore();
const ttsClient = new textToSpeech.TextToSpeechClient();
const storage = new Storage();

const BUCKET_NAME = 'conquer-english-app-audio'; 
const VOICE_NAME = 'en-US-Chirp3-HD-Aoede'; 
const DELAY_MS = 150; // small pause between calls to stay well within API rate limits

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateAudioForWord(doc) {
  const { word } = doc.data();
  const filename = `${word.toLowerCase().replace(/[^a-z0-9]/g, '-')}.wav`;

  const [response] = await ttsClient.synthesizeSpeech({
    input: { text: word },
    voice: { languageCode: 'en-US', name: VOICE_NAME },
    audioConfig: { audioEncoding: 'LINEAR16', pitch: 0, speakingRate: 1 }
  });

  const file = storage.bucket(BUCKET_NAME).file(filename);
  await file.save(response.audioContent, { contentType: 'audio/wav' });

  const audioUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${filename}`;
  await doc.ref.update({ audioUrl });
  return audioUrl;
}

async function run() {
  const snap = await db.collection('words').get();
  const missing = snap.docs.filter(doc => !doc.data().audioUrl);

  console.log(`${snap.size} total words, ${missing.length} missing audio.`);

  let done = 0;
  for (const doc of missing) {
    try {
      const url = await generateAudioForWord(doc);
      done++;
      console.log(`[${done}/${missing.length}] "${doc.data().word}" -> ${url}`);
    } catch (err) {
      console.error(`Failed on "${doc.data().word}":`, err.message);
    }
    await sleep(DELAY_MS);
  }

  console.log('Done generating audio.');
}

run().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});