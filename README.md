# Eyes for Everyone

A phone web app for people with low vision. **The whole screen is one giant button.**
Tap to take a photo, ask a question out loud, tap again, and hear the answer.

The app does two things:

- **Describe:** tap anywhere to take a photo. The description **streams in and is read aloud while it is still being written**. Tap again for the next photo. Double-tap (or the mic button) to ask a question about the same photo: just speak, and the app **notices when you stop talking** and answers, like Siri. There is no stop button.
- **Qibla:** choose Qibla at the bottom (or swipe). It **starts by itself**: a live, talking compass with the distance and direction to the Kaaba. There is nothing to tap.

| Gesture | What happens |
| --- | --- |
| **Tap** (Describe) | Take a photo and hear what is in it. After an answer, tap again for the next photo. |
| **Double-tap** (after an answer) | Ask a question about the same photo. |
| **Press and hold** | Repeat the last answer. |
| **Hold 3 seconds** | Settings (or tap ⚙). |
| **Swipe left / right** | Switch between Describe and Qibla. |
| **Swipe down** | Open a picture from the gallery. |
| **Drag the answer sheet** | Expand it for long answers, or shrink it to one line. |

**Laptop / PC:** click anywhere to take a photo, or drop / paste a picture. **Upload photo** is in the bottom corner. A laptop has no compass, so Qibla does not draw one there: it says to use a phone, and gives the bearing from north and the distance.

--- | --- |
| **Tap** (READY) | Takes a photo (shutter sound + buzz). Too dark or blurry? It tells you and waits. |
| **Tap** (LISTENING) | Stops recording and asks the AI. |
| **Tap** (ANSWER) | Take the **next photo** straight away (same mode). |
| **Double-tap** (ANSWER) | Ask another question about the **same** photo. |
| **Double-tap** (while listening / thinking) | Cancel and go back to the camera. |
| **Press and hold** | Repeat the last answer. |
| **Hold 3 seconds** | Settings: language, text size, speech speed, colours, screen reader mode (or tap ⚙). |
| **Swipe left / right** (or tap a mode name) | Change mode: **Ask**, **Read**, **Money**, **Color**, **Light**, **Qibla**. |
| **Swipe down** | Open a picture from the gallery. |

There is no shutter button: **tap anywhere**. At the **bottom** are the **gallery** button, **Describe | Qibla**, and one button that changes with the moment (*repeat* when ready, *ask about it* after an answer). At the **top** are **help (?)** and **settings (⚙)**.

**Laptop / PC:** click anywhere to take a photo, or drop / paste a picture. **Upload photo** is in the bottom corner. A laptop has no compass, so Qibla does not draw one there: it says to use a phone, and gives the bearing from north and the distance.

| Say *repeat · faster · slower · louder · change language · bigger text* | Voice commands while listening (English, Arabic, Malayalam). |

Taps while THINKING are ignored, and extra taps within 500 ms are ignored so accidental double touches do nothing.

---

## Folder structure (one sentence each, for a 9-year-old)

```
Eyes-for-Everyone/
├── api/                      ← the small robots that live on the server
│   ├── ask.js                ← takes your photo and question and asks the AI what it sees.
│   ├── transcribe.js         ← listens to your recorded voice and writes down the words.
│   ├── speak.js              ← turns words into a natural voice with ElevenLabs.
│   ├── health.js             ← tells the app which AI helpers are switched on.
│   └── _lib/
│       ├── ai.js             ← knows how to talk to Gemini, OpenRouter and ElevenLabs, and holds the AI's rules.
│       └── http.js           ← the door guard that only lets our own app in.
├── public/                   ← everything your phone downloads
│   ├── index.html            ← the skeleton of the one big screen.
│   ├── css/app.css           ← the paint: big letters, strong colours, shiny glass and glowing animations.
│   ├── js/app.js             ← the brain that decides what happens after every tap.
│   ├── js/sensors.js         ← the Qibla compass: GPS + compass, works without the internet.
│   ├── sw.js                 ← keeps a copy of the app so it opens offline.
│   ├── js/glass.js           ← makes the glass as clear as possible but never too clear to read, and moves its shine.
│   ├── js/camera.js          ← opens the camera, snaps the photo, and checks it is not too dark or blurry.
│   ├── js/listen.js          ← records your question with the microphone.
│   ├── js/voice.js           ← makes the phone talk.
│   ├── js/sounds.js          ← makes the little click, beep and chime sounds.
│   ├── js/commands.js        ← notices when you say "repeat" or "faster" instead of a question.
│   ├── js/i18n.js            ← every sentence in English, Arabic and Malayalam.
│   ├── js/settings.js        ← remembers your language, speed, text size and colours on your phone.
│   ├── about.html + about.css ← an Arabic-first page about the app, for journalists and visitors (/about).
│   ├── manifest.webmanifest  ← lets you add the app to your home screen like a real app.
│   ├── icons/                ← the app's eye picture (SVG, plus PNGs for installing on phones).
│   └── test/                 ← the secret grown-up page at /test
│       ├── index.html        ← the test page layout.
│       ├── test.js           ← runs many photos through the AI and lets you mark Correct, Partly or Wrong.
│       └── test.css          ← the test page's paint.
├── dev-server.js             ← a pretend Vercel so you can try the app on your laptop.
├── vercel.json               ← instructions that tell Vercel how to put the app on the internet.
├── package.json              ← the app's name tag.
├── .env.example              ← a blank form showing where the secret AI keys go.
└── .gitignore                ← a list of files that must never be uploaded (like your keys).
```

---

## Run it on your laptop

1. **Install Node.js** (one time): download the LTS version from <https://nodejs.org> and install it.
2. **Add your AI key(s):** copy `.env.example` to a new file named `.env` and paste your key(s):
   ```
   GEMINI_API_KEY=your-gemini-key
   OPENROUTER_API_KEY=your-openrouter-key
   ELEVENLABS_API_KEY=your-elevenlabs-key
   ```
   - **OpenRouter** (free models only) answers first: Qwen 3.8 27B, then Gemma 4. When they are busy or out of quota, **Gemini** (the cheapest Flash-Lite) answers instead. You need at least one of the two.
   - **ElevenLabs** (recommended) gives the app one natural voice in English, Arabic *and* Malayalam, and the best speech-to-text (Scribe).
     Without it, the phone's own voice is used and Gemini does the speech-to-text.
   With no keys at all, the app still runs in *demo mode* with a pretend answer.
3. **Start it:**
   ```bash
   node dev-server.js
   ```
4. Open <http://localhost:3000>. Add `?demo` to the address (<http://localhost:3000/?demo>) to use a pretend camera if your laptop has none.

No `npm install` is needed. The app has zero dependencies.

## Open it on your phone

Phones only allow the camera and microphone on **https** pages. The easy way is Vercel:

### A. Vercel (recommended)
1. Go to <https://vercel.com/yazaneva4-3470s-projects/eyes-for-everyone> → **Settings → Git** and connect the GitHub repo `yazaneva4/Eyes-for-Everyone` (if it is not already connected).
2. **Settings → Environment Variables**: add `GEMINI_API_KEY` and/or `OPENROUTER_API_KEY`, plus `ELEVENLABS_API_KEY` (Production + Preview). Then redeploy.
3. Framework preset: **Other**. Leave build command empty. (`vercel.json` already sets the output folder to `public`.)
4. Every `git push` deploys automatically. Open the `…vercel.app` link on your phone.
5. Optional: in Safari or Chrome, choose **Add to Home Screen** so it opens full-screen like an app.

### B. On your home Wi-Fi (for quick testing)
```bash
mkdir -p .cert && openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=localhost" -keyout .cert/key.pem -out .cert/cert.pem
node dev-server.js
```
The server prints a `Phone: https://192.168.x.x:3000` address. Open it on a phone on the same Wi-Fi and accept the certificate warning.

---

## The test page (`/test`)

It is not linked anywhere. Type `/test` after the address.

1. Put photos in a folder. Add `questions.csv` with the columns `file,question`, or `questions.json` like `{"photo1.jpg": "What does the label say?"}`.
2. Click **Photo folder** and choose the folder, then **Run all**.
3. Mark each reply **Correct / Partly / Wrong**. The score is shown at the top.
4. **Export CSV** downloads a results table (file, question, language, AI, reply, rating, time).

Replies and ratings are kept in that browser only. Photos are never stored.

---

## Privacy and safety

- API keys live only in `.env` / Vercel environment variables. Browser code never sees them.
- Photos, audio and transcripts are **never saved**. They stay in the phone's memory and are sent once to the AI, and the server does not log them.
- The API only answers requests from the app's own website.
- The AI follows strict rules in `api/_lib/ai.js`:
  - It answers in the user's language with short sentences, most important thing first, with positions and colours.
  - It never identifies people.
  - It reads printed text exactly. For medicine it reads the printed text only, then says "Please check with a person."
  - It gives no medical advice and no road-crossing or other safety-critical guidance.
  - It says "I'm not sure" and asks for a new photo instead of guessing.
- On first run the app shows and speaks: **"This is a helper, not a safety tool."**
- Camera and microphone turn off when the app goes to the background.

## Look and feel

It is built to feel like a modern camera app, not a remote control:
- The camera fills the screen, with viewfinder corners and a breathing shutter ring.
- While you speak, rings around a microphone grow with your voice and the screen edge glows.
- While it thinks, a rainbow edge turns around the screen and a colourful orb glows.
- The answer rises in a frosted-glass sheet over the photo it describes.
- Landscape puts the picture on one side and the words on the other.
- **Adaptive Liquid Glass:** `glass.js` measures the picture behind every glass panel, several times a second over the live camera. It then picks the clearest glass (down to 42% opacity) that still keeps text at 7.5:1 contrast. Over dark scenes the glass is very clear, and over a bright window it frosts up.
- The glass has a bright lens rim, a shine that follows your finger (and the phone's tilt on Android), a springy "gel" squish when you press it, and real light-bending refraction in Chrome.

## Keeping costs low

- Gemini uses the cheapest image-capable model your key can use (Flash-Lite), with "thinking" off or at its minimum.
- Photos are sent at reduced detail (about 256–280 image tokens). Full detail is used only when the question asks to read something, like a label, sign, price, date or medicine box.
- Answers are capped at 300 output tokens (800 when reading text). Follow-ups send only the last two questions.
- Free OpenRouter models answer first, so most questions cost nothing. Gemini is only used when they are busy.
- The `/test` page shows the real input and output tokens for every answer, and they are included in the CSV export.

## Low-vision design

- Text is 24 pt by default and can be set from 18 to 64 pt; it never scrolls. Long answers shrink to fit, then show one sentence at a time in step with the voice.
- There are three themes, all well above 7:1 contrast: yellow on black (default), white on black, and black on white. The "liquid glass" panels are at least 85% opaque, so the camera behind them can't lower the contrast.
- The screen stays awake, and portrait and landscape both work.
- Live regions announce every state to screen readers. **Screen reader mode** turns off the app's own voice so VoiceOver or TalkBack can read everything; the whole screen is one labelled button they can activate.
- No tutorial: the first tap opens the camera (the phone asks for permission) and the app speaks the disclaimer once.

## Settings you can change (optional environment variables)

| Name | Default | Meaning |
| --- | --- | --- |
| `AI_PROVIDER` | `openrouter` | Which AI answers first (`openrouter` or `gemini`). The other one is the automatic fallback. |
| `GEMINI_MODEL` | *(cheapest available)* | By default the app tries `gemini-2.5-flash-lite` ($0.10/$0.40), then `gemini-3.1-flash-lite` ($0.25/$1.50), then `gemini-3.5-flash-lite` ($0.30/$2.50), and remembers any that Google has retired. Set this to force one model. |
| `GEMINI_FALLBACK_MODEL` | *(none)* | Optional second Gemini model. By default the free OpenRouter models are the backup instead. |
| `OPENROUTER_MODEL` | `qwen/qwen3.8-27b:free` | **Only free models are used**: an ID must end in `:free`, and safety-filter models are blocked. Backups: `google/gemma-4-31b-it:free`, `google/gemma-4-26b-a4b-it:free`. |
| `ELEVENLABS_VOICE_ID` | `JBFqnCBsd6RMkjVDRZzb` | Any voice ID from your ElevenLabs voice library. |
| `ELEVENLABS_TTS_MODEL` | `eleven_flash_v2_5` for English and Arabic, `eleven_v3` for Malayalam | Flash is fastest but has no Malayalam. Override one language with `ELEVENLABS_TTS_MODEL_ML` (or `_EN`, `_AR`). |
| `ELEVENLABS_STT_MODEL` | `scribe_v2` | ElevenLabs speech-to-text, tried first, with Gemini as the backup. |
