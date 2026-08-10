
# MindGrid 🧠

> "You don't place your move. You earn it."

MindGrid reimagines Tic Tac Toe as an AI negotiation game. Instead of clicking an empty square, you have to **convince** the AI character guarding that cell to let you claim it. Every cell has its own personality, memory, and mood — and losing an argument has real consequences on the board.

## Features

- **9 unique AI personalities** — Sleepy Sam, Greedy Greg, Logical Bot, Ego King, Meme Lord, Secret Agent, Chaos Kid, Professor, and Ghost — each convinced by a different kind of argument.
- **Real tic-tac-toe rules** — standard 3-in-a-row wins, but losing a negotiation lets the guardian claim the cell for itself.
- **Three game modes:**
  - **Puzzle** — solo challenge against static guardians
  - **Rival** — turn-based match against an AI opponent that picks its own cells and argues back
  - **Local PvP** — two players, one device, alternating turns
- **Character memory** — guardians remember how you've treated them. Insult one and they hold a grudge for the rest of the match.
- **Random world events** — mood shifts and personality swaps keep every match unpredictable.
- **AI-powered dialogue** — every character's reaction is generated live, so no two matches play out the same way.

## Tech Stack

- **Frontend:** React + Vite
- **AI Backend:** Netlify Functions (serverless) proxying to the Gemini API
- **Hosting:** Netlify

## How the AI negotiation works

Every negotiation outcome (accept / partial / reject) is decided by a **deterministic local scoring engine**, not by the AI itself. The engine checks your argument against the guardian's personality, memory, and the board's current mood — then the Gemini API is only asked to *narrate* that already-decided outcome in the character's voice. This keeps the actual game logic fair, fast, and fully under the game's control.

> **Note:** The game is fully playable even without an API key — the win/loss logic never depends on the AI. If `GEMINI_API_KEY` isn't set (or the API call fails for any reason), each character falls back to a small set of generic pre-written lines instead of crashing. To get each character's actual unique, personality-driven dialogue, set up a free Gemini API key as described below.

## Running locally

```bash
npm install
npx netlify dev
```

`netlify dev` runs both the Vite frontend and the serverless function together, so AI negotiation works on localhost. Plain `npm run dev` will load the UI but AI calls will fail, since there's no function server behind them.

You'll need a free Gemini API key from [Google AI Studio](https://aistudio.google.com), set as an environment variable named `GEMINI_API_KEY`.

## Deployment

This project is built to deploy on **Netlify** (GitHub Pages won't work — it can't run the serverless function this game needs for AI calls).

1. Push this repo to GitHub
2. Import it into Netlify (build settings are already configured via `netlify.toml`)
3. Add `GEMINI_API_KEY` under Site settings → Environment variables
4. Trigger a deploy

## Project Structure

```
mindgrid/
├── src/
│   ├── MindGrid.jsx      # Main game component
│   └── main.jsx          # React entry point
├── netlify/
│   └── functions/
│       └── negotiate.js  # Serverless proxy to the Gemini API
├── index.html
├── vite.config.js
├── netlify.toml
└── package.json
```

## Roadmap

- [ ] Persistent match history and player profiles (database-backed)
- [ ] Richer per-character long-term memory across turns
- [ ] Sound effects and animated character expressions
- [ ] Mobile app version

## Credits

Built by Nikhil Singh — original concept and character personalities designed as part of the MindGrid project pitch.

---

## Live Demo 🚀

Try MindGrid in your browser here: [tictactoemindgrid.netlify.app](https://tictactoemindgrid.netlify.app)


