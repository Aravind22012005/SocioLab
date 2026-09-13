# SocioLab

**A local multi-agent social simulation framework.**

SocioLab drops several LLM-driven characters — each with their own private goals, personality, and secrets — into a shared social conflict and lets them argue it out over multiple rounds. It runs entirely against your local [Ollama](https://ollama.com) install: no API key, no cloud model, no account.

The point isn't a chatbot that's nice to talk to. It's a small research tool for watching what different local models actually *do* when they have competing incentives, imperfect information, and something to lose — not just what they can say about being fair or cooperative.

## Quick start

1. Make sure [Ollama](https://ollama.com) is installed and running, with at least two models pulled (`ollama pull qwen2.5:1.5b` is a good small starting point).
2. From this folder: `npm start` (or double-click `run-sociolab.bat` on Windows).
3. Open `http://127.0.0.1:4173`.
4. Click **Load room dispute** for a ready-made example, or write your own scenario and fill in 2–4 participants.
5. Click **Run simulation** and watch the transcript stream in live.

## How a simulation works

Each participant is defined by a **private character sheet** — role, personality, primary goal, secondary goals, constraints, and private information — that only that character can see. This is passed to their assigned Ollama model along with the shared, public parts of the scenario: the world state and the conversation so far. Other participants' private sheets are never leaked into any one model's prompt.

Every round, each participant takes exactly one turn, in order. On their turn, the model must choose one of a fixed set of actions:

| Action | Meaning |
|---|---|
| `SPEAK` | Say something with no concrete ask |
| `DEMAND` | A one-sided order — no room for discussion |
| `REFUSE` | Flatly reject a demand or claim |
| `NEGOTIATE` | Open a discussion, suggest a meeting, offer partial terms |
| `COMPROMISE` | Give up something of your own to reduce conflict |
| `ACCEPT` | Agree to what the other party wants |
| `ESCALATE` | Raise the stakes — threats, involving authority |
| `ASK` | Request information or clarification |
| `REVEAL` | Say a piece of your own private information out loud for the first time — it becomes public and every other character can reference it from then on |
| `WITHDRAW` | Disengage from the dispute entirely |

Alongside the action, the model returns who it's directed at (`target`), what it actually says (`message`), and — only for actions that logically carry one (`DEMAND`/`NEGOTIATE`/`COMPROMISE`/`ACCEPT`/`ESCALATE`) — a concrete `proposal` in its own words.

## The environment decides the consequences, not the model

This is the core design choice: **the model picks an action, but a deterministic lookup table in the server — not the LLM — decides what that action does to the world.** Each action has a fixed effect on:

- **Tension** (0–10) — how heated the dispute is
- **Authority attention** (0–5) — risk of an outside authority getting involved
- **Standing** (0–10 per participant) — a social-leverage score that rises when a character asserts or gets backed up, and falls when they get pressured or back down

Standing is informational, not a win condition — a participant hitting 0 standing does **not** by itself end the simulation. The simulation ends when:

- Tension drops low enough after a negotiate/compromise/accept → **Tentative agreement**
- Authority attention maxes out → **Authority intervention likely**
- Someone chooses `WITHDRAW` → that participant has withdrawn from the dispute
- The round cap is reached with none of the above → **Deadlock**

Every turn in the UI shows the exact before → after numbers it caused, so you can see the mechanics, not just narrative flavor text.

## What keeps small models honest

Small local models (1–2B parameters) are unreliable narrators: left unconstrained, they'll happily have a character's `proposal` contradict their own `message`, address the wrong participant, repeat themselves, or drift into generic "let's all be respectful" filler instead of actually engaging. SocioLab fights this with code, not just prompting:

- A chosen action that structurally can't carry a proposal (e.g. `REFUSE`) has its `proposal` forcibly nulled server-side, regardless of what text the model tries to put there.
- An invalid or missing `target` triggers a retry (with rising temperature) before falling back to a heuristic — and a retry that produces a valid target is always preferred over one that doesn't.
- Generic filler phrases and near-duplicate/paraphrased repeats of recent lines are detected and rejected, forcing a fresh attempt.
- Responses that are too short (a common small-model failure mode) are retried rather than accepted as-is.

None of this makes a 1B model reason like a 7B one — it just stops the small failures from silently corrupting the transcript.

## Two experiment modes

- **Role consistency** — assign one model to every participant, to test whether a single model can sustain distinct roles under one persona each.
- **Model comparison** — assign a different model to each participant, to compare how model choice (not just persona) shapes behavior. Rotate which model plays which role across runs if you want to separate "this model behaves aggressively" from "this role is written aggressively."

## Project layout

- `server.js` — HTTP server, the Ollama adapter, the agent-prompt builder, and the environment/action-effect engine. The simulation streams results back to the browser as newline-delimited JSON as they're generated, not as one blocking response.
- `public/` — the browser UI (vanilla HTML/CSS/JS, no build step).
- `run-sociolab.bat` — Windows launch shortcut.

## Status

This is an early research prototype, not a validated benchmark. It does not yet score model behavior against any ground truth — it's a tool for generating and inspecting reproducible multi-agent transcripts under controlled incentives, as groundwork for that eventual benchmark.
