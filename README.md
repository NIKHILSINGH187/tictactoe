# MindGrid — Deploy Guide (Gemini version, free tier)

## Simple bhasha mein poora process

**Kya ho raha hai:** Tumhara game (React) browser mein chalta hai. Lekin AI
se baat karne wala kaam (character ka reply banwana) ek chhoti si "function"
(`netlify/functions/negotiate.js`) karta hai jo Netlify ke server pe chalta
hai — isiliye tumhari API key safe rehti hai, browser mein kabhi nahi jaati.

Ye function ab **Gemini** use karta hai (free), Claude nahi.

---

### Step 1 — Gemini API key lo (free, card nahi chahiye)
1. https://aistudio.google.com pe jao
2. Apne Google account se sign in karo
3. Left side "Get API key" pe click karo → "Create API key"
4. Key copy kar lo (ye baad mein lagegi)

Free tier limits: roughly 10 requests/minute, 250 requests/din
(`gemini-2.5-flash` model pe) — ek game session ke liye kaafi hai.

### Step 2 — GitHub pe push karo
Terminal mein, is folder ke andar:
```
git init
git add .
git commit -m "MindGrid"
git branch -M main
git remote add origin https://github.com/<tumhara-username>/mindgrid.git
git push -u origin main
```

### Step 3 — Netlify pe connect karo
1. netlify.com pe jao → "Add new site" → "Import an existing project"
2. Apna GitHub repo select karo
3. Build settings already set hain (`netlify.toml` file mein) — bas "Deploy" dabao

### Step 4 — API key Netlify mein daalo
1. Netlify dashboard mein: Site settings → Environment variables → "Add a variable"
2. Key ka naam: `GEMINI_API_KEY`
3. Value: Step 1 wali key paste karo
4. Save karo, phir Deploys → "Trigger deploy" (taaki naya key use ho)

### Step 5 — Test karo
Netlify wali live URL kholo, koi mode choose karo, kisi character se
negotiate karke dekho. Agar hamesha generic reply aaye jaise "...fine, it's
yours" (asli AI reply nahi), to samjho function fail ho raha hai — Netlify
mein Site → Functions → negotiate → Logs check karo, wahan exact error dikhega
(zyada tar galat ya missing key hoti hai).

---

## Local pe test karna (deploy karne se pehle)
```
npm install
npx netlify dev
```
Sirf `npm run dev` mat chalana — usse AI wala part kaam nahi karega kyunki
function server nahi chal raha hoga. `netlify dev` dono ek saath chalata hai.

## Note
- GitHub Pages pe ye deploy NAHI ho sakta, kyunki wo sirf static files serve
  karta hai, function nahi chala sakta. Netlify (ya Vercel) hi sahi jagah hai
  is project ke liye — Bunkometer se different, jisme koi backend nahi chahiye tha.
- Agar bahut zyada log game khelenge, free tier ki limit (250 requests/din)
  khatam ho sakti hai — tab tak dekh lena, abhi ke liye ye kaafi hai.
