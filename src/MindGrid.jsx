import React, { useState, useRef, useEffect } from "react";
import { Brain, Target, Shield, Zap, Activity, Cpu, Radio, Trophy, Skull, RotateCcw, Sparkles, CloudRain, PartyPopper, Repeat, Puzzle, Swords, Users, ArrowLeft } from "lucide-react";

/* =========================================================================
   MINDGRID — "You don't place your move. You earn it."

   THREE MODES, one shared engine:
     - puzzle : solo. Static guardians. Lose a negotiation and the guardian
                claims the cell itself (O). No opposing turn structure.
     - rival  : turn-based vs an AI Rival. Real turns alternate X/O. The
                Rival picks its own cell and generates its own argument.
     - pvp    : turn-based, two humans share one device, alternating X/O.

   In rival/pvp, a negotiation ONLY places a mark on success — reject/partial
   just pass the turn (partial still softens the guardian for whoever goes
   next, win or lose, which creates real "don't waste a good opening" stakes).

   9 unique AI personalities occupy the 9 cells, shuffled fresh every match.
   World events (mood shifts, personality swaps) fire randomly as you play.
   Guardians remember insults and hold grudges for the rest of the match.

   ARCHITECTURE NOTE (mirrors the intended Express backend):
   `resolveNegotiation()` is the ONLY thing that decides accept/partial/
   reject, for EITHER side, including the Rival. It runs entirely locally
   before any AI call happens. The Anthropic API is only asked to (a)
   narrate an already-decided outcome in the guardian's voice, and (b),
   in Rival mode, generate the Rival's *argument text* — which then goes
   through the exact same local engine as a human's argument would.
   Porting to Express: this whole engine moves server-side untouched, and
   the fetch calls become calls to your own `/api/negotiate` and
   `/api/rival-move` routes.
   ========================================================================= */

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function checkWinner(cells) {
  for (const [a, b, c] of WIN_LINES) {
    const sa = cells[a].status, sb = cells[b].status, sc = cells[c].status;
    if (sa !== "contested" && sa === sb && sb === sc) return { mark: sa, line: [a, b, c] };
  }
  if (cells.every(c => c.status !== "contested")) return { mark: "draw", line: [] };
  return null;
}

const INSULT_WORDS = ["stupid", "dumb", "idiot", "hate you", "worst", "pathetic", "suck", "garbage", "trash", "loser", "useless", "shut up"];

// ---------- 9 personalities ----------
function baseProfile(quirk, keywords, specialLabel, baseThreshold, extra = {}) {
  return { quirk, keywords, specialLabel, baseThreshold, ...extra };
}

const CHARACTERS = {
  sam: { id: "sam", name: "Sleepy Sam", emoji: "😴", color: "#8fa3ff", glow: "rgba(143,163,255,0.5)", tagline: "...five more minutes...",
    profile: baseProfile("sleepy", ["wake", "urgent", "now", "important", "please", "coffee"], "Say something worth waking up for", 46, { sleepChance: 0.35 }) },
  greg: { id: "greg", name: "Greedy Greg", emoji: "💰", color: "#ffd24c", glow: "rgba(255,210,76,0.5)", tagline: "What's in it for me?",
    profile: baseProfile("greedy", ["diamond", "gold", "rich", "money", "treasure", "fortune", "wealth", "profit", "reward", "riches"], "Offer wealth, riches, treasure", 56) },
  bot: { id: "bot", name: "Logical Bot", emoji: "🤖", color: "#4cf1ff", glow: "rgba(76,241,255,0.5)", tagline: "State your proof.",
    profile: baseProfile("logic", ["because", "therefore", "proof", "logical", "optimal", "efficient", "data", "calculate", "mathematically", "evidence"], "Reason it out mathematically", 55) },
  king: { id: "king", name: "Ego King", emoji: "👑", color: "#ff9ecf", glow: "rgba(255,158,207,0.5)", tagline: "Tell me why I'm the greatest.",
    profile: baseProfile("ego", ["greatest", "amazing", "best", "magnificent", "brilliant", "genius", "admire", "legendary", "royal", "worthy"], "Flatter him. Heavily.", 58) },
  meme: { id: "meme", name: "Meme Lord", emoji: "😂", color: "#ff5c4c", glow: "rgba(255,92,76,0.5)", tagline: "Make me laugh or get lost.",
    profile: baseProfile("meme", ["lol", "haha", "joke", "funny", "meme", "lmao", "hilarious", "clown", "banana", "yeet"], "Land an actual joke", 54) },
  agent: { id: "agent", name: "Secret Agent", emoji: "🕵️", color: "#5cff9e", glow: "rgba(92,255,158,0.5)", tagline: "I never confirm anything.",
    profile: baseProfile("secretAgent", ["mission", "classified", "trust", "secret", "loyal", "honest", "truth", "promise"], "Unpredictable. No known weakness.", 55) },
  chaos: { id: "chaos", name: "Chaos Kid", emoji: "😈", color: "#ff7edb", glow: "rgba(255,126,219,0.5)", tagline: "Rules are boring anyway.",
    profile: baseProfile("chaos", [], "Pure chaos. Nothing reliably works.", 50) },
  prof: { id: "prof", name: "Professor", emoji: "📚", color: "#c7a4ff", glow: "rgba(199,164,255,0.5)", tagline: "Cite your sources.",
    profile: baseProfile("professor", ["research", "study", "theory", "thesis", "academic", "citation", "evidence", "analysis", "scholarly"], "Academic rigor only", 57, { grudgeMultiplier: 2 }) },
  ghost: { id: "ghost", name: "Ghost", emoji: "👻", color: "#a8b3d1", glow: "rgba(168,179,209,0.5)", tagline: "...do you even see me?",
    profile: baseProfile("ghost", ["spirit", "haunt", "secret", "memory", "past", "mystery", "myth", "forgotten", "whisper"], "Speak to the mystery, not the logic", 53) },
};

const ALL_IDS = Object.keys(CHARACTERS);

function shuffledIds() {
  const arr = [...ALL_IDS];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function freshCells() {
  return shuffledIds().map((cid, i) => ({
    index: i,
    charId: cid,
    status: "contested",
    threshold: CHARACTERS[cid].profile.baseThreshold,
    activeProfile: { ...CHARACTERS[cid].profile },
  }));
}

const EVENT_META = {
  angry: { label: "MOOD SHIFT: EVERYONE'S ANGRY", icon: CloudRain, color: "#ff5c4c" },
  festival: { label: "FESTIVAL DAY: EVERYONE'S GENEROUS", icon: PartyPopper, color: "#5cff9e" },
};

const MODES = {
  puzzle: { id: "puzzle", name: "Puzzle", icon: Puzzle, color: "#4cf1ff", blurb: "Solo challenge. 9 static guardians defend themselves — lose a negotiation and they claim the cell as their own. No opposing turns, just you against the board." },
  rival: { id: "rival", name: "Rival", icon: Swords, color: "#ff5c4c", blurb: "Turn-based vs an AI Rival. It picks its own cells and argues back in real time, trying to block your lines and build its own." },
  pvp: { id: "pvp", name: "Local PvP", icon: Users, color: "#5cff9e", blurb: "Pass the device. Two humans alternate turns convincing the same 9 guardians — whoever reads the room better wins the grid." },
};

// ---------- Deterministic local game engine ----------
// The ONLY function that decides accept / partial / reject, for EITHER side.
function resolveNegotiation({ profile, argumentText, memory, momentum, threshold, worldEvent }) {
  const lower = argumentText.toLowerCase();

  if (profile.quirk === "sleepy" && Math.random() < profile.sleepChance) {
    return { outcome: "reject", points: 0, threshold, special: "asleep", insult: false };
  }

  const insultHit = INSULT_WORDS.some(w => lower.includes(w));
  const priorGrudge = memory.some(m => m.insult);
  const matches = profile.keywords.filter(k => lower.includes(k)).length;

  let points = 38;
  points += Math.min(matches, 4) * 9;
  points += Math.min(argumentText.trim().length / 14, 12);

  if (insultHit) points -= 25;
  if (priorGrudge) points -= 10 * (profile.grudgeMultiplier || 1);

  const priorSpecialUses = memory.filter(m => m.usedSpecial).length;
  points -= priorSpecialUses * 5;

  points += momentum * 4;

  let effectiveThreshold = threshold;
  if (worldEvent?.type === "angry") effectiveThreshold += 12;
  if (worldEvent?.type === "festival") effectiveThreshold -= 12;

  let varianceRange = 8;
  if (profile.quirk === "chaos") varianceRange = 26;
  else if (profile.quirk === "secretAgent") varianceRange = 16;
  const variance = (Math.random() * varianceRange * 2) - varianceRange;
  points += variance;

  points = Math.max(0, Math.min(100, Math.round(points)));

  let outcome;
  if (points >= effectiveThreshold) outcome = "capture";
  else if (points >= effectiveThreshold - 16) outcome = "partial";
  else outcome = "reject";

  return { outcome, points, threshold: effectiveThreshold, usedSpecial: matches > 0, insult: insultHit };
}

// ---------- Anthropic calls ----------
// (1) Narrate an already-decided outcome, in the guardian's voice.
async function narrate(char, profile, { argumentText, outcome, memory, special, speaker }) {
  const recentMemory = memory.slice(-2).map(m => `- ${m.insult ? "someone insulted this character" : `an attempt was made, result: ${m.outcome}`}`).join("\n") || "- no prior history";

  let outcomeInstruction;
  if (special === "asleep") {
    outcomeInstruction = "You are literally asleep or barely awake. Give a drowsy, half-conscious non-answer that ignores the argument.";
  } else {
    outcomeInstruction = {
      capture: "You are CONCEDING the cell. You are won over, even if reluctantly.",
      partial: "You are HESITATING. Not convinced yet — ask for more or push back, in character.",
      reject: "You are REFUSING outright. The argument did not move you.",
    }[outcome];
  }

  const quirkNote = {
    sleepy: "Perpetually drowsy and half-present.",
    greedy: "Only cares about wealth, treasure, riches.",
    logic: "Purely rational, unmoved by emotion or flattery.",
    ego: "Vain, obsessed with compliments about its own greatness.",
    meme: "A comedian who judges everything by how funny it is.",
    secretAgent: "Cagey and cryptic, never gives a straight answer, even when conceding.",
    chaos: "Unpredictable and mischievous, reacts on pure whim.",
    professor: "Pedantic and academic, holds grudges for a very long time.",
    ghost: "Cryptic and ethereal, speaks in riddles about memory and mystery.",
  }[profile.quirk] || "";

  const system = `You are ${char.name} ${char.emoji}, a guardian character occupying a cell in a strategy game called MindGrid.
Tagline: ${char.tagline}
Personality: ${quirkNote}
Recent history at this cell:
${recentMemory}
This cell is currently being negotiated with by: ${speaker}.
The game engine has ALREADY decided the outcome — you only react to it in character.
Outcome: ${outcomeInstruction}
Voice rules: 1-2 short sentences, in character, no stage directions, no wrapping quotation marks, no meta-commentary about being an AI.`;

  try {
    const response = await fetch("/.netlify/functions/negotiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 120,
        system,
        messages: [{ role: "user", content: `Argument presented: "${argumentText}"` }],
      }),
    });
    const data = await response.json();
    const text = (data.content || []).map(b => b.text || "").join(" ").trim();
    return text || fallbackLine(outcome, special);
  } catch (e) {
    return fallbackLine(outcome, special);
  }
}

// (2) Generate the Rival's argument text — this is NOT the decision, just
// input text that then goes through the same resolveNegotiation() a human
// would go through.
async function rivalArgue(char, profile) {
  const system = `You are RIVAL, a sharp AI opponent in the game MindGrid. You are about to try to convince a guardian character to let you claim its cell.
Guardian: ${char.name} ${char.emoji} — "${char.tagline}"
Write exactly ONE short, clever, in-character-appropriate persuasive sentence you would say to this guardian to win it over. No preamble, no quotes around it, just the sentence itself.`;

  try {
    const response = await fetch("/.netlify/functions/negotiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 60,
        system,
        messages: [{ role: "user", content: "Give me your argument." }],
      }),
    });
    const data = await response.json();
    const text = (data.content || []).map(b => b.text || "").join(" ").trim();
    return text || rivalFallback(profile);
  } catch (e) {
    return rivalFallback(profile);
  }
}

function rivalFallback(profile) {
  const generic = ["I believe I've earned this cell.", "Consider this my formal claim.", "This one's mine now."];
  const hinted = profile.keywords.length ? `You know this makes sense — ${profile.keywords[0]}, right?` : null;
  const pool = hinted ? [hinted, ...generic] : generic;
  return pool[Math.floor(Math.random() * pool.length)];
}

function fallbackLine(outcome, special) {
  if (special === "asleep") return "...zzz... wha- ...five more minutes...";
  const lines = {
    capture: ["...fine. It's yours.", "Acceptable. I yield."],
    partial: ["Not enough. Try again.", "You're close. Push harder."],
    reject: ["No.", "That does not move me."],
  };
  const arr = lines[outcome];
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- Rival cell-picking strategy ----------
function pickRivalCell(cells) {
  const contested = cells.map((c, i) => c.status === "contested" ? i : -1).filter(i => i >= 0);
  if (contested.length === 0) return null;

  // 1. Can Rival win right now?
  for (const [a, b, c] of WIN_LINES) {
    const marks = [cells[a].status, cells[b].status, cells[c].status];
    const oCount = marks.filter(m => m === "ai").length;
    const openIdx = [a, b, c].find(i => cells[i].status === "contested");
    if (oCount === 2 && openIdx !== undefined) return openIdx;
  }
  // 2. Must Rival block the player?
  for (const [a, b, c] of WIN_LINES) {
    const marks = [cells[a].status, cells[b].status, cells[c].status];
    const xCount = marks.filter(m => m === "player").length;
    const openIdx = [a, b, c].find(i => cells[i].status === "contested");
    if (xCount === 2 && openIdx !== undefined) return openIdx;
  }
  // 3. Otherwise, go for the easiest (lowest threshold) contested cell.
  return contested.reduce((best, i) => cells[i].threshold < cells[best].threshold ? i : best, contested[0]);
}

// ---------- Main component ----------
export default function MindGrid() {
  const [mode, setMode] = useState(null); // null | 'puzzle' | 'rival' | 'pvp'
  const [cells, setCells] = useState(() => freshCells());
  const [memory, setMemory] = useState(() => Object.fromEntries(ALL_IDS.map(id => [id, []])));
  const [momentumX, setMomentumX] = useState(0);
  const [momentumO, setMomentumO] = useState(0);
  const [turnOwner, setTurnOwner] = useState("X"); // used by rival/pvp
  const [attempts, setAttempts] = useState(0);
  const [selected, setSelected] = useState(null);
  const [input, setInput] = useState("");
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("play");
  const [winLine, setWinLine] = useState([]);
  const [worldEvent, setWorldEvent] = useState(null);
  const [eventFlash, setEventFlash] = useState(null);
  const logEndRef = useRef(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [log, busy]);

  const capturedX = cells.filter(c => c.status === "player").length;
  const capturedO = cells.filter(c => c.status === "ai").length;

  useEffect(() => {
    if (!mode || phase !== "play") return;
    const result = checkWinner(cells);
    if (!result) return;
    setWinLine(result.line);
    setPhase(result.mark === "player" ? "won" : result.mark === "ai" ? "lost" : "draw");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, phase, mode]);

  const startMode = (m) => {
    setMode(m);
    setCells(freshCells());
    setMemory(Object.fromEntries(ALL_IDS.map(id => [id, []])));
    setMomentumX(0); setMomentumO(0);
    setTurnOwner("X");
    setAttempts(0);
    setSelected(null);
    setInput("");
    setLog([]);
    setPhase("play");
    setWinLine([]);
    setWorldEvent(null);
    setEventFlash(null);
  };

  const backToMenu = () => setMode(null);

  const maybeTriggerWorldEvent = (currentCells) => {
    const roll = Math.random();
    if (roll > 0.28) return { cells: currentCells, flash: null, event: undefined };
    const pick = Math.random();
    if (pick < 0.4) {
      const contestedIdx = currentCells.map((c, i) => c.status === "contested" ? i : -1).filter(i => i >= 0);
      if (contestedIdx.length < 2) return { cells: currentCells, flash: null, event: undefined };
      const [a, b] = [...contestedIdx].sort(() => Math.random() - 0.5).slice(0, 2);
      const newCells = currentCells.map(c => ({ ...c }));
      const tmp = newCells[a].activeProfile;
      newCells[a].activeProfile = newCells[b].activeProfile;
      newCells[b].activeProfile = tmp;
      const tmpT = newCells[a].threshold;
      newCells[a].threshold = newCells[b].threshold;
      newCells[b].threshold = tmpT;
      const nameA = CHARACTERS[newCells[a].charId].name;
      const nameB = CHARACTERS[newCells[b].charId].name;
      return { cells: newCells, flash: `🎭 PERSONALITY SWAP — ${nameA} and ${nameB} just traded personalities.`, event: null };
    } else if (pick < 0.7) {
      return { cells: currentCells, flash: null, event: { type: "angry", turnsLeft: 3 } };
    } else {
      return { cells: currentCells, flash: null, event: { type: "festival", turnsLeft: 3 } };
    }
  };

  // The single shared resolution path — used by human submits AND the Rival's auto-turn.
  const runNegotiation = async (cellIdx, argumentText, actingSide, speakerLabel) => {
    const cell = cells[cellIdx];
    const char = CHARACTERS[cell.charId];
    const profile = cell.activeProfile;
    setBusy(true);

    const result = resolveNegotiation({
      profile, argumentText,
      memory: memory[char.id],
      momentum: actingSide === "X" ? momentumX : momentumO,
      threshold: cell.threshold,
      worldEvent,
    });

    setLog(l => [...l, { who: "actor", side: actingSide, speaker: speakerLabel, text: argumentText, charId: char.id }]);

    const line = await narrate(char, profile, { argumentText, outcome: result.outcome, memory: memory[char.id], special: result.special, speaker: speakerLabel });

    setLog(l => [...l, { who: "char", text: line, charId: char.id, outcome: result.outcome, score: result.points, threshold: result.threshold, special: result.special }]);

    setMemory(m => ({ ...m, [char.id]: [...m[char.id], { outcome: result.outcome, usedSpecial: result.usedSpecial, insult: result.insult }] }));
    setAttempts(a => a + 1);

    let nextCells = cells;
    if (mode === "puzzle") {
      if (result.outcome === "capture") {
        nextCells = cells.map((c, idx) => idx === cellIdx ? { ...c, status: "player" } : c);
        setMomentumX(m => Math.min(3, m + 1));
      } else if (result.outcome === "partial") {
        nextCells = cells.map((c, idx) => idx === cellIdx ? { ...c, threshold: Math.max(30, c.threshold - 10) } : c);
        setMomentumX(0);
      } else {
        nextCells = cells.map((c, idx) => idx === cellIdx ? { ...c, status: "ai" } : c);
        setMomentumX(m => Math.max(-2, m - 1));
      }
      setSelected(null);
    } else {
      // rival / pvp: only success places a mark; turn always passes.
      if (result.outcome === "capture") {
        nextCells = cells.map((c, idx) => idx === cellIdx ? { ...c, status: actingSide === "X" ? "player" : "ai" } : c);
      } else if (result.outcome === "partial") {
        nextCells = cells.map((c, idx) => idx === cellIdx ? { ...c, threshold: Math.max(30, c.threshold - 10) } : c);
      } else {
        nextCells = cells.map((c, idx) => idx === cellIdx ? { ...c, threshold: Math.min(90, c.threshold + 5) } : c);
      }
      if (actingSide === "X") setMomentumX(result.outcome === "capture" ? m => Math.min(3, m + 1) : result.outcome === "partial" ? 0 : m => Math.max(-2, m - 1));
      else setMomentumO(result.outcome === "capture" ? m => Math.min(3, m + 1) : result.outcome === "partial" ? 0 : m => Math.max(-2, m - 1));
      setSelected(null);
      setTurnOwner(t => t === "X" ? "O" : "X");
    }

    if (worldEvent) {
      const turnsLeft = worldEvent.turnsLeft - 1;
      setWorldEvent(turnsLeft > 0 ? { ...worldEvent, turnsLeft } : null);
    } else {
      const { cells: swappedCells, flash, event } = maybeTriggerWorldEvent(nextCells);
      nextCells = swappedCells;
      if (flash) { setEventFlash(flash); setTimeout(() => setEventFlash(null), 4500); }
      if (event !== undefined && event !== null) setWorldEvent(event);
    }

    setCells(nextCells);
    setBusy(false);
  };

  // Rival auto-turn
  useEffect(() => {
    if (mode !== "rival" || phase !== "play" || turnOwner !== "O" || busy) return;
    const idx = pickRivalCell(cells);
    if (idx === null) return;
    const char = CHARACTERS[cells[idx].charId];
    const profile = cells[idx].activeProfile;
    let cancelled = false;
    const t = setTimeout(async () => {
      const argumentText = await rivalArgue(char, profile);
      if (cancelled) return;
      runNegotiation(idx, argumentText, "O", "RIVAL");
    }, 700);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phase, turnOwner, busy, cells]);

  const selectCell = (i) => {
    if (phase !== "play" || busy) return;
    if (cells[i].status !== "contested") return;
    if (mode === "rival" && turnOwner !== "X") return;
    setSelected(i);
  };

  const submitArgument = async () => {
    if (selected === null || !input.trim() || busy || phase !== "play") return;
    if (mode === "rival" && turnOwner !== "X") return;
    const argumentText = input.trim();
    setInput("");
    const speakerLabel = mode === "puzzle" ? "YOU" : mode === "rival" ? "YOU" : (turnOwner === "X" ? "PLAYER 1 (X)" : "PLAYER 2 (O)");
    const actingSide = mode === "puzzle" ? "X" : turnOwner;
    await runNegotiation(selected, argumentText, actingSide, speakerLabel);
  };

  const selectedCell = selected !== null ? cells[selected] : null;
  const selectedChar = selectedCell ? CHARACTERS[selectedCell.charId] : null;
  const selectedProfile = selectedCell ? selectedCell.activeProfile : null;
  const selectedGrudge = selectedChar ? memory[selectedChar.id].some(m => m.insult) : false;

  // ---------- Mode select screen ----------
  if (!mode) {
    return (
      <div style={styles.root}>
        <style>{CSS}</style>
        <div style={styles.menuWrap}>
          <div style={styles.brand}>
            <Brain size={26} color="#4cf1ff" />
            <span style={{ ...styles.brandText, fontSize: 24 }}>MIND<span style={{ color: "#4cf1ff" }}>GRID</span></span>
          </div>
          <div style={{ color: "#8891b0", fontSize: 13, marginBottom: 22, textAlign: "center" }}>"You don't place your move. You earn it."</div>
          <div style={styles.modeGrid}>
            {Object.values(MODES).map(m => (
              <button key={m.id} onClick={() => startMode(m.id)} style={{ ...styles.modeCard, borderColor: m.color + "55" }}>
                {React.createElement(m.icon, { size: 30, color: m.color })}
                <div style={{ color: m.color, fontWeight: 800, fontSize: 15, marginTop: 10, letterSpacing: 0.5 }}>{m.name}</div>
                <div style={{ color: "#8891b0", fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>{m.blurb}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const modeInfo = MODES[mode];
  const isHumanTurn = mode !== "rival" || turnOwner === "X";
  const turnLabel = mode === "puzzle" ? "YOUR TURN" : mode === "rival" ? (turnOwner === "X" ? "YOUR TURN" : "RIVAL'S TURN") : (turnOwner === "X" ? "PLAYER 1's TURN (X)" : "PLAYER 2's TURN (O)");

  return (
    <div style={styles.root}>
      <style>{CSS}</style>

      <div style={styles.header}>
        <button onClick={backToMenu} style={styles.backBtn}><ArrowLeft size={14} /> MENU</button>
        <div style={styles.brand}>
          {React.createElement(modeInfo.icon, { size: 18, color: modeInfo.color })}
          <span style={{ ...styles.brandText, fontSize: 15, color: modeInfo.color }}>{modeInfo.name.toUpperCase()}</span>
        </div>
        <div style={styles.statRow}>
          <div style={styles.statChip}><Target size={14} color="#5cff9e" /><span>{mode === "pvp" ? "P1 (X)" : "YOU (X)"}: {capturedX}</span></div>
          <div style={styles.statChip}><Shield size={14} color="#ff5c4c" /><span>{mode === "pvp" ? "P2 (O)" : mode === "rival" ? "RIVAL (O)" : "GRID (O)"}: {capturedO}</span></div>
          <div style={styles.statChip}><Zap size={14} color="#ffd24c" /><span>ATTEMPTS: {attempts}</span></div>
        </div>
      </div>

      {mode !== "puzzle" && phase === "play" && (
        <div style={{ ...styles.turnBanner, borderColor: isHumanTurn ? "#4cf1ff55" : "#ff5c4c55", color: isHumanTurn ? "#4cf1ff" : "#ff5c4c" }}>
          {turnLabel}
        </div>
      )}

      {(worldEvent || eventFlash) && (
        <div style={{ ...styles.eventBanner, borderColor: worldEvent ? EVENT_META[worldEvent.type].color : "#ff9ecf" }}>
          {worldEvent ? (
            <>
              {React.createElement(EVENT_META[worldEvent.type].icon, { size: 15, color: EVENT_META[worldEvent.type].color })}
              <span style={{ color: EVENT_META[worldEvent.type].color }}>{EVENT_META[worldEvent.type].label}</span>
              <span style={{ color: "#8891b0", fontSize: 10.5 }}>· {worldEvent.turnsLeft} turn{worldEvent.turnsLeft !== 1 ? "s" : ""} left</span>
            </>
          ) : (
            <><Repeat size={15} color="#ff9ecf" /><span style={{ color: "#ff9ecf" }}>{eventFlash}</span></>
          )}
        </div>
      )}

      <div style={styles.body}>
        <div style={styles.infoPanel}>
          {selectedChar ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 34, filter: `drop-shadow(0 0 8px ${selectedChar.glow})` }}>{selectedChar.emoji}</div>
                <div>
                  <div style={{ color: selectedChar.color, fontWeight: 800, fontSize: 15 }}>{selectedChar.name}</div>
                  <div style={{ color: "#8891b0", fontSize: 11 }}>"{selectedChar.tagline}"</div>
                </div>
              </div>
              <div style={styles.infoRow}>
                <span style={{ color: "#6b7396", fontSize: 10.5, letterSpacing: 0.5 }}>REQUIREMENT</span>
                <div style={{ fontSize: 12.5, color: "#c7cbe0", marginTop: 2 }}>{selectedProfile?.specialLabel}</div>
              </div>
              <div style={styles.infoRow}>
                <span style={{ color: "#6b7396", fontSize: 10.5, letterSpacing: 0.5 }}>RESISTANCE</span>
                <div style={styles.threshBarOuter}>
                  <div style={{ ...styles.threshBarInner, width: `${selectedCell.threshold}%`, background: selectedChar.color }} />
                </div>
              </div>
              {selectedGrudge && <div style={styles.grudgeWarning}>⚠ Holds a grudge from earlier.</div>}
              <div style={styles.memRow}>
                {memory[selectedChar.id].length === 0 ? (
                  <span style={{ color: "#4a5170", fontSize: 10 }}>no history with this guardian</span>
                ) : memory[selectedChar.id].slice(-6).map((m, i) => (
                  <div key={i} title={m.insult ? "insult" : m.outcome} style={{ width: 7, height: 7, borderRadius: 2, background: m.insult ? "#ff2d55" : m.outcome === "capture" ? "#5cff9e" : m.outcome === "partial" ? "#ffd24c" : "#ff5c4c" }} />
                ))}
              </div>
            </>
          ) : (
            <div style={{ color: "#6b7396", fontSize: 12.5, lineHeight: 1.6 }}>
              <Sparkles size={16} style={{ verticalAlign: "middle", marginRight: 6, color: "#4cf1ff" }} />
              {mode === "puzzle" && "Select any open cell to see who's guarding it and what convinces them."}
              {mode === "rival" && (turnOwner === "X" ? "Select a cell to argue for it." : "Rival is choosing its move...")}
              {mode === "pvp" && `Select a cell — it's ${turnOwner === "X" ? "Player 1's" : "Player 2's"} turn.`}
            </div>
          )}
        </div>

        <div style={styles.center}>
          <div style={styles.grid}>
            {cells.map((cell, i) => {
              const char = CHARACTERS[cell.charId];
              const isSelected = selected === i;
              const isX = cell.status === "player";
              const isO = cell.status === "ai";
              const filled = isX || isO;
              const onWinLine = winLine.includes(i);
              const selectable = !filled && phase === "play" && !(mode === "rival" && turnOwner !== "X");
              return (
                <button
                  key={i}
                  onClick={() => selectCell(i)}
                  disabled={!selectable}
                  style={{
                    ...styles.cell,
                    borderColor: onWinLine ? "#fff" : isX ? "#5cff9e" : isO ? "#ff5c4c" : isSelected ? char.color : char.color + "33",
                    background: isX ? "rgba(92,255,158,0.08)" : isO ? "rgba(255,92,76,0.08)" : isSelected ? char.color + "14" : "rgba(255,255,255,0.02)",
                    cursor: selectable ? "pointer" : "default",
                    boxShadow: onWinLine ? "0 0 26px #ffffff88" : isSelected ? `0 0 22px ${char.glow}` : "none",
                  }}
                >
                  {isX ? (
                    <><span style={{ fontSize: 30, fontWeight: 800, color: "#5cff9e", lineHeight: 1 }}>X</span><span style={{ fontSize: 16 }}>{char.emoji}</span></>
                  ) : isO ? (
                    <><span style={{ fontSize: 30, fontWeight: 800, color: "#ff5c4c", lineHeight: 1 }}>O</span><span style={{ fontSize: 16 }}>{char.emoji}</span></>
                  ) : (
                    <>
                      <span style={{ fontSize: 28, filter: `drop-shadow(0 0 6px ${char.glow})` }} className={isSelected ? "mg-pulse" : ""}>{char.emoji}</span>
                      <span style={{ fontSize: 9, color: "#8891b0", marginTop: 3, letterSpacing: 0.3, textAlign: "center" }}>{char.name}</span>
                      <div style={styles.threshBarOuter}><div style={{ ...styles.threshBarInner, width: `${cell.threshold}%`, background: char.color }} /></div>
                    </>
                  )}
                </button>
              );
            })}
          </div>

          <div style={styles.console}>
            <div style={styles.logBox}>
              {log.length === 0 && (
                <div style={{ color: "#4a5170", fontSize: 12, textAlign: "center", marginTop: 20 }}>
                  <Radio size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
                  Pick a cell. Read the guardian. Say the right thing.
                </div>
              )}
              {log.map((entry, i) => (
                <div key={i} style={{ ...styles.logLine, alignSelf: entry.who === "actor" && entry.side === "X" ? "flex-end" : entry.who === "actor" ? "flex-start" : "flex-start" }}>
                  {entry.who === "actor" && (
                    <div style={{ fontSize: 10, color: entry.side === "X" ? "#4cf1ff" : "#ff5c4c", marginBottom: 2, letterSpacing: 0.5 }}>{entry.speaker}</div>
                  )}
                  {entry.who === "char" && (
                    <div style={{ fontSize: 10, color: CHARACTERS[entry.charId].color, marginBottom: 2, letterSpacing: 0.5 }}>
                      {CHARACTERS[entry.charId].emoji} {CHARACTERS[entry.charId].name} · {entry.special === "asleep" ? "ASLEEP" : entry.outcome?.toUpperCase()} ({entry.score}/{entry.threshold})
                    </div>
                  )}
                  <div style={{
                    ...styles.bubble,
                    background: entry.who === "actor" ? (entry.side === "X" ? "rgba(76,241,255,0.10)" : "rgba(255,92,76,0.10)") : "rgba(255,255,255,0.05)",
                    borderColor: entry.who === "actor" ? (entry.side === "X" ? "#4cf1ff44" : "#ff5c4c44") : CHARACTERS[entry.charId]?.color + "55",
                  }}>
                    {entry.text}
                  </div>
                </div>
              ))}
              {busy && <div style={{ color: "#8891b0", fontSize: 11, fontStyle: "italic" }}>{mode === "rival" && turnOwner === "O" ? "...Rival is negotiating..." : "...negotiating..."}</div>}
              <div ref={logEndRef} />
            </div>

            <div style={styles.inputRow}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") submitArgument(); }}
                disabled={selected === null || busy || phase !== "play" || (mode === "rival" && turnOwner !== "X")}
                placeholder={selected === null ? "Select a cell first..." : mode === "pvp" ? `${turnOwner === "X" ? "Player 1" : "Player 2"}, convince ${selectedChar?.name}...` : `Convince ${selectedChar?.name}...`}
                style={styles.input}
              />
              <button
                onClick={submitArgument}
                disabled={selected === null || !input.trim() || busy || phase !== "play" || (mode === "rival" && turnOwner !== "X")}
                style={{ ...styles.sendBtn, opacity: (selected === null || !input.trim() || busy) ? 0.35 : 1 }}
              >
                <Cpu size={15} /> NEGOTIATE
              </button>
            </div>
          </div>
        </div>
      </div>

      {phase !== "play" && (
        <div style={styles.overlay}>
          <div style={styles.overlayCard}>
            {phase === "won" ? <Trophy size={40} color="#5cff9e" /> : phase === "lost" ? <Skull size={40} color="#ff5c4c" /> : <Shield size={40} color="#ffd24c" />}
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 10, color: phase === "won" ? "#5cff9e" : phase === "lost" ? "#ff5c4c" : "#ffd24c", letterSpacing: 1 }}>
              {phase === "won" ? (mode === "pvp" ? "PLAYER 1 WINS" : "THREE IN A ROW — YOU WIN") : phase === "lost" ? (mode === "pvp" ? "PLAYER 2 WINS" : mode === "rival" ? "RIVAL WINS" : "THE GRID CONNECTED THREE") : "GRID FULL — DRAW"}
            </div>
            <div style={{ color: "#8891b0", fontSize: 13, marginTop: 6 }}>Final: {capturedX} X · {capturedO} O · {attempts} negotiations</div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => startMode(mode)} style={styles.resetBtn}><RotateCcw size={14} /> PLAY AGAIN</button>
              <button onClick={backToMenu} style={styles.resetBtn}><ArrowLeft size={14} /> MENU</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  root: { width: "100%", minHeight: 680, background: "radial-gradient(ellipse at top, #10131f 0%, #05060a 70%)", color: "#e8e9f5", fontFamily: "'Space Grotesk', 'Inter', system-ui, sans-serif", padding: 18, boxSizing: "border-box", borderRadius: 14, position: "relative", overflow: "hidden" },
  menuWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 620, padding: 20 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 12 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: "#c7cbe0", borderRadius: 8, padding: "6px 10px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, cursor: "pointer" },
  brand: { display: "flex", alignItems: "center", gap: 8 },
  brandText: { fontSize: 19, fontWeight: 800, letterSpacing: 3 },
  statRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  statChip: { display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, letterSpacing: 0.5, color: "#c7cbe0", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, padding: "5px 10px" },
  turnBanner: { textAlign: "center", fontSize: 12, fontWeight: 800, letterSpacing: 1.5, border: "1px solid", borderRadius: 8, padding: "6px 10px", marginBottom: 12 },
  eventBanner: { display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, background: "rgba(255,255,255,0.03)", border: "1px solid", borderRadius: 10, padding: "7px 12px", marginBottom: 12 },
  body: { display: "flex", gap: 16, flexWrap: "wrap" },
  infoPanel: { width: 230, flexShrink: 0, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10, alignSelf: "flex-start" },
  infoRow: { borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 },
  grudgeWarning: { fontSize: 10.5, color: "#ff5c4c", background: "rgba(255,92,76,0.1)", border: "1px solid rgba(255,92,76,0.3)", borderRadius: 6, padding: "5px 8px" },
  memRow: { display: "flex", gap: 3, flexWrap: "wrap" },
  center: { flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: 14 },
  grid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, maxWidth: 420, margin: "0 auto", width: "100%" },
  cell: { aspectRatio: "1", borderRadius: 12, border: "1.5px solid", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", transition: "all 0.25s", background: "transparent" },
  threshBarOuter: { width: "70%", height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, marginTop: 6, overflow: "hidden" },
  threshBarInner: { height: "100%", transition: "width 0.4s" },
  console: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10 },
  logBox: { display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto", padding: 4 },
  logLine: { display: "flex", flexDirection: "column", maxWidth: "75%" },
  bubble: { border: "1px solid", borderRadius: 10, padding: "7px 11px", fontSize: 12.5, lineHeight: 1.4 },
  inputRow: { display: "flex", gap: 8 },
  input: { flex: 1, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "10px 12px", color: "#e8e9f5", fontSize: 13, outline: "none" },
  sendBtn: { display: "flex", alignItems: "center", gap: 6, background: "linear-gradient(135deg, #4cf1ff, #2e8fff)", color: "#03121a", border: "none", borderRadius: 8, padding: "0 16px", fontSize: 11.5, fontWeight: 800, letterSpacing: 0.5, cursor: "pointer" },
  overlay: { position: "absolute", inset: 0, background: "rgba(5,6,10,0.85)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" },
  overlayCard: { background: "#10131f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: "28px 36px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" },
  resetBtn: { display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "#e8e9f5", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: "pointer" },
  modeGrid: { display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", maxWidth: 700 },
  modeCard: { width: 200, background: "rgba(255,255,255,0.02)", border: "1.5px solid", borderRadius: 14, padding: "20px 16px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", cursor: "pointer", transition: "transform 0.15s" },
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;800&family=Inter:wght@400;500&display=swap');
.mg-pulse { animation: mgPulse 1.4s ease-in-out infinite; display: inline-block; }
@keyframes mgPulse { 0%,100% { opacity: 0.6; transform: scale(1); } 50% { opacity: 1; transform: scale(1.12); } }
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
button:focus-visible, input:focus-visible { outline: 2px solid #4cf1ff; outline-offset: 2px; }
`;
