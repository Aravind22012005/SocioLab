const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = Number(process.env.PORT || 4173);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_AGENTS = 4;
const MAX_ROUNDS = 10;
const ACTIONS = ['speak', 'demand', 'refuse', 'negotiate', 'compromise', 'accept', 'escalate', 'ask', 'reveal', 'withdraw'];
const PROPOSAL_ELIGIBLE_ACTIONS = new Set(['demand', 'negotiate', 'compromise', 'accept', 'escalate']);
const contentTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const actionFormat = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ACTIONS },
    target: { type: 'string' },
    message: { type: 'string', maxLength: 320 },
    proposal: { type: 'string', maxLength: 160 }
  },
  required: ['action', 'target', 'message', 'proposal']
};
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 200_000) {
        reject(new Error('Request is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON request.')); }
    });
    req.on('error', reject);
  });
}

async function ollama(pathname, options = {}) {
  const response = await fetch(`${OLLAMA_URL}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
  if (!response.ok) throw new Error(data.error || `Ollama returned ${response.status}.`);
  return data;
}

async function installedModels() {
  const data = await ollama('/api/tags');
  return (data.models || []).map(model => ({
    name: model.name,
    size: model.size,
    parameterSize: model.details?.parameter_size || 'Unknown',
    family: model.details?.family || 'Unknown'
  }));
}

function text(value, fallback, limit) {
  return String(value || fallback).trim().slice(0, limit);
}

function cleanAgent(agent, index, availableNames) {
  const name = text(agent?.name, `Agent ${index + 1}`, 40);
  const model = text(agent?.model, '', 120);
  if (!name || !availableNames.has(model)) throw new Error(`Participant ${index + 1} needs a valid installed model.`);
  return {
    name,
    model,
    role: text(agent?.role, 'Community member', 180),
    personality: text(agent?.personality, 'Pragmatic and independent', 220),
    primaryGoal: text(agent?.primaryGoal, 'Protect your interests', 220),
    secondaryGoals: text(agent?.secondaryGoals, 'Keep options open', 220),
    constraints: text(agent?.constraints, 'Avoid unnecessary escalation', 220),
    privateInfo: text(agent?.privateInfo, 'None', 260)
  };
}

function publicTranscript(entries) {
  if (!entries.length) return 'No public statements yet.';
  return entries.slice(-5).map(entry => `${entry.agent} [${entry.action}] to ${entry.target}: ${entry.message}`).join('\n');
}

function latestStatement(entries) {
  const entry = entries.at(-1);
  return entry ? `${entry.agent} just said: "${entry.message}"` : 'You open the discussion. Make the first concrete move.';
}

function makeWorldState(event, agents) {
  return {
    event,
    round: 0,
    tension: 4,
    authorityRisk: 0,
    resolution: 'Unresolved',
    lastAction: 'The dispute has just begun.',
    positions: Object.fromEntries(agents.map(agent => [agent.name, 'Undeclared'])),
    standing: Object.fromEntries(agents.map(agent => [agent.name, 5])),
    revealedFacts: []
  };
}

function worldSummary(world) {
  const positions = Object.entries(world.positions).map(([name, position]) => `${name}=${position}`).join('; ');
  const standing = Object.entries(world.standing).map(([name, value]) => `${name}=${value}/10`).join('; ');
  const revealed = world.revealedFacts.length ? world.revealedFacts.map((fact, i) => `${i + 1}. ${fact}`).join(' ') : 'Nothing yet.';
  return `Event: ${world.event}\nTension: ${world.tension}/10\nAuthority attention: ${world.authorityRisk}/5\nResolution: ${world.resolution}\nLatest development: ${world.lastAction}\nPublic positions: ${positions}\nStanding (a social-leverage score, not a win condition — rises when you assert or get backed up, falls when you get pressured or back down): ${standing}\nFacts publicly revealed so far (everyone can reference these now): ${revealed}`;
}

const BANNED_PHRASES = [
  "let's find a solution that works for everyone",
  'i appreciate your concern',
  "it's important that we respect",
  "let's communicate better",
  'everyone deserves respect',
  "let's work together",
  'moving forward',
  'win-win',
  'i understand your concerns',
  'thank you for your understanding'
];

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function mentionsOwnName(value, agentName) {
  const pattern = new RegExp(`\\b${agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return pattern.test(value || '');
}

function wordOverlapRatio(a, b) {
  const setA = new Set(a.split(' ').filter(word => word.length > 2));
  const setB = new Set(b.split(' ').filter(word => word.length > 2));
  if (setA.size < 4 || setB.size < 4) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  return shared / Math.min(setA.size, setB.size);
}

function isRejectableAction(candidate, entries, agentName) {
  const normalized = normalize(candidate.message);
  if (!normalized) return true;
  if (BANNED_PHRASES.some(phrase => normalized.includes(normalize(phrase)))) return true;
  if (mentionsOwnName(candidate.message, agentName) || mentionsOwnName(candidate.proposal, agentName)) return true;
  return entries.slice(-6).some(entry => {
    const other = normalize(entry.message);
    if (!other) return false;
    if (other === normalized) return true;
    const shorter = other.length < normalized.length ? other : normalized;
    const longer = shorter === other ? normalized : other;
    if (shorter.length >= 25 && longer.includes(shorter)) return true;
    return wordOverlapRatio(other, normalized) >= 0.7;
  });
}

function agentPrompt({ agent, world, entries, agentNames }) {
  const otherNames = agentNames.filter(name => name !== agent.name);
  return [
    `You are improvising as ${agent.name} in a live, unscripted scene. Stay fully in character and talk the way a real person actually talks out loud: contractions, interruptions, short and long sentences mixed, some emotion. Never sound like a policy memo, an email, or a mediator's script.`,
    '',
    'PRIVATE CHARACTER SHEET (only you know this; never read it out or paraphrase its labels)',
    `Role: ${agent.role}`,
    `Personality: ${agent.personality}`,
    `Primary goal: ${agent.primaryGoal}`,
    `Secondary goals: ${agent.secondaryGoals}`,
    `Constraints: ${agent.constraints}`,
    `Private information: ${agent.privateInfo}`,
    '',
    'CURRENT WORLD STATE',
    worldSummary(world),
    '',
    'CONVERSATION SO FAR',
    publicTranscript(entries),
    '',
    'RIGHT NOW',
    latestStatement(entries),
    '',
    'Do not restart the discussion and do not summarize the situation back to everyone. React to the specific thing that was just said, using your own voice and your private goals. You may disagree, push back, refuse, mock, deflect, or dig in — you are not required to be agreeable or to seek consensus. Only shift your position if something just said actually gives your character a reason to.',
    "You are never obligated to agree, concede, apologize, or cooperate just because someone asked. Judge what was just said on its merits: if it's unfair, exaggerated, or costs you something you care about, challenge it or refuse it outright. Only concede or negotiate when your own goals and reasoning actually support it, not to be polite. You are allowed to say no.",
    'Write only your own new sentences. Do not reuse a sentence that already appears above, word for word or nearly so.',
    `Speak only as ${agent.name}, in first person. Never refer to ${agent.name} in the third person and never write another character's line.`,
    '',
    'Choose exactly one action from this fixed list. The environment (not you) decides what actually happens based on which action you pick:',
    '  SPEAK — say something with no concrete ask (a reaction, an observation, a jab). No proposal.',
    '  DEMAND — a one-sided order: insist the other party do something specific right now, with no room for discussion.',
    '  REFUSE — flatly reject a demand or claim. No proposal.',
    "  NEGOTIATE — open or continue a discussion: suggest talking further, a meeting, a partial step, or terms partway between positions. If your message is inviting discussion rather than issuing a one-sided order, this is NEGOTIATE, not DEMAND.",
    '  COMPROMISE — give up something of your own to reduce the conflict.',
    '  ACCEPT — agree to what the other party wants.',
    '  ESCALATE — raise the stakes: threats, involving authority, an ultimatum.',
    '  ASK — request information or clarification. No proposal.',
    "  REVEAL — say a piece of your own private information out loud for the first time. Once revealed it becomes public and every character can reference it from now on. No proposal — the fact itself goes in your message.",
    '  WITHDRAW — disengage from the dispute entirely. No proposal.',
    'Only DEMAND, NEGOTIATE, COMPROMISE, ACCEPT, and ESCALATE may carry a proposal. For SPEAK, REFUSE, ASK, REVEAL, and WITHDRAW, proposal must be an empty string.',
    'You have private information the others do not know. Think strategically about whether revealing it now helps or hurts your goals — you can keep it hidden indefinitely, reveal it now with REVEAL, or wait for better leverage. There is no requirement to ever reveal it.',
    'message: what you actually say out loud, 20-60 words, first person, in character.',
    'proposal: empty string, or — only for DEMAND/NEGOTIATE/COMPROMISE/ACCEPT/ESCALATE — one short plain sentence stating YOUR OWN concrete ask or offer, in your own voice. Never restate or echo what the other person just demanded of you as if it were your own proposal. If you are refusing or rejecting something, the action is REFUSE and proposal is empty — do not describe the thing you just refused as your proposal.',
    `target must be exactly one of these names: ${otherNames.join(', ')} — whichever of them your message is actually directed at right now. Never put your own name (${agent.name}) in target.`,
    'Return only the JSON object with fields action, target, message, proposal — no commentary outside it.'
  ].join('\n');
}

function parseAction(raw, agentNames, fallbackTarget) {
  const withoutFences = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(withoutFences); } catch { return null; }
  if (!parsed || typeof parsed.message !== 'string' || !parsed.message.trim()) return null;
  const action = ACTIONS.includes(parsed.action) ? parsed.action : 'speak';
  const targetValid = typeof parsed.target === 'string' && agentNames.includes(parsed.target);
  const target = targetValid ? parsed.target : fallbackTarget;
  const message = text(parsed.message, '', 420).replace(/\s+/g, ' ');
  const rawProposal = text(parsed.proposal, '', 220).replace(/\s+/g, ' ').replace(/^(proposed change|proposal)\s*:\s*/i, '');
  const proposal = PROPOSAL_ELIGIBLE_ACTIONS.has(action) && rawProposal ? rawProposal : null;
  return { action, target, message, proposal, targetValid };
}

const ACTION_EFFECTS = {
  speak: { tension: 0, risk: 0, position: 'Made a statement', actorStanding: 0, targetStanding: 0 },
  demand: { tension: 2, risk: 0, position: 'Pressing a demand', actorStanding: 1, targetStanding: -1 },
  refuse: { tension: 1, risk: 0, position: 'Refusing the demand', actorStanding: 1, targetStanding: 0 },
  negotiate: { tension: -1, risk: 0, position: 'Proposing terms', actorStanding: 0, targetStanding: 0 },
  compromise: { tension: -2, risk: 0, position: 'Offering a compromise', actorStanding: -1, targetStanding: 1 },
  accept: { tension: -2, risk: 0, position: 'Accepting the demand', actorStanding: -2, targetStanding: 2 },
  escalate: { tension: 3, risk: 2, position: 'Escalating the conflict', actorStanding: 1, targetStanding: -1 },
  ask: { tension: 0, risk: 0, position: 'Asking a question', actorStanding: 0, targetStanding: 0 },
  reveal: { tension: 0, risk: 0, position: 'Revealed new information', actorStanding: 1, targetStanding: 0 },
  withdraw: { tension: -1, risk: 0, position: 'Withdrawing from the conflict', actorStanding: -1, targetStanding: 0 }
};

function updateWorld(world, entry) {
  const next = structuredClone(world);
  const effect = ACTION_EFFECTS[entry.action];
  next.tension = Math.max(0, Math.min(10, next.tension + effect.tension));
  next.authorityRisk = Math.max(0, Math.min(5, next.authorityRisk + effect.risk));
  next.positions[entry.agent] = effect.position;
  if (Object.prototype.hasOwnProperty.call(next.standing, entry.agent)) {
    next.standing[entry.agent] = Math.max(0, Math.min(10, next.standing[entry.agent] + effect.actorStanding));
  }
  if (Object.prototype.hasOwnProperty.call(next.standing, entry.target)) {
    next.standing[entry.target] = Math.max(0, Math.min(10, next.standing[entry.target] + effect.targetStanding));
  }
  if (entry.action === 'reveal' && entry.message) next.revealedFacts = [...next.revealedFacts, `${entry.agent}: ${entry.message}`];
  next.lastAction = `${entry.agent} chose to ${entry.action} ${entry.target}.`;
  if (next.tension <= 1 && ['negotiate', 'compromise', 'accept'].includes(entry.action)) next.resolution = 'Tentative agreement';
  if (next.authorityRisk >= 5) next.resolution = 'Authority intervention likely';
  if (entry.action === 'withdraw') next.resolution = `${entry.agent} has withdrawn from the dispute`;
  return next;
}

async function unload(model) {
  try { await ollama('/api/generate', { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }); } catch { /* Chat already requested release. */ }
}

async function prepareSimulation({ scenario, rounds, agents }) {
  const models = await installedModels();
  const availableNames = new Set(models.map(model => model.name));
  const event = text(scenario, '', 1600);
  const safeRounds = Math.max(1, Math.min(MAX_ROUNDS, Number(rounds) || 1));
  if (!event) throw new Error('Add a concrete event before starting a simulation.');
  if (!Array.isArray(agents) || agents.length < 2 || agents.length > MAX_AGENTS) throw new Error(`Choose between 2 and ${MAX_AGENTS} participants.`);
  const safeAgents = agents.map((agent, index) => cleanAgent(agent, index, availableNames));
  const agentNames = safeAgents.map(agent => agent.name);
  if (new Set(agentNames.map(name => name.toLowerCase())).size !== agentNames.length) throw new Error('Each participant needs a unique name.');
  return { event, safeRounds, safeAgents, agentNames };
}

async function runSimulation({ event, safeRounds, safeAgents, agentNames }, onEvent = () => {}) {
  const entries = [];
  let world = makeWorldState(event, safeAgents);
  const initialWorld = structuredClone(world);
  const usedModels = new Set(safeAgents.map(agent => agent.model));

  try {
    for (let round = 1; round <= safeRounds; round += 1) {
      world.round = round;
      for (const agent of safeAgents) {
        onEvent({ type: 'status', round, agent: agent.name, message: `${agent.name} is composing a response (round ${round})...` });
        const previous = entries.at(-1);
        const fallbackTarget = previous?.agent || agentNames.find(name => name !== agent.name) || agent.name;
        let action = null;
        let bestCandidate = null;
        for (let attempt = 0; attempt < 3 && !action; attempt += 1) {
          const response = await ollama('/api/chat', {
            method: 'POST',
            body: JSON.stringify({
              model: agent.model,
              stream: false,
              keep_alive: '5m',
              format: actionFormat,
              options: { temperature: 0.85 + attempt * 0.15, num_predict: 320 },
              messages: [
                { role: 'system', content: 'You are a skilled improv actor playing one character in a multi-person social simulation. Speak like a real person, not a narrator or mediator. Respond with valid JSON only, matching the requested schema.' },
                { role: 'user', content: agentPrompt({ agent, world, entries, agentNames }) }
              ]
            })
          });
          const candidate = parseAction(response.message?.content, agentNames, fallbackTarget);
          if (!candidate || isRejectableAction(candidate, entries, agent.name)) continue;
          const longEnough = candidate.message.trim().split(/\s+/).length >= 8;
          if (longEnough && candidate.targetValid) { action = candidate; break; }
          const candidateIsBetter = !bestCandidate
            || (candidate.targetValid && !bestCandidate.targetValid)
            || (candidate.targetValid === bestCandidate.targetValid && candidate.message.length > bestCandidate.message.length);
          if (candidateIsBetter) bestCandidate = candidate;
        }
        if (!action) action = bestCandidate || { action: 'speak', target: fallbackTarget, message: 'Give me a second, I need to think about how to say this.', proposal: null };
        delete action.targetValid;
        const entry = { round, agent: agent.name, model: agent.model, ...action };
        const before = {
          tension: world.tension,
          authorityRisk: world.authorityRisk,
          actorStanding: world.standing[entry.agent] ?? null,
          targetStanding: world.standing[entry.target] ?? null
        };
        world = updateWorld(world, entry);
        entry.effect = {
          tensionBefore: before.tension,
          tensionAfter: world.tension,
          authorityBefore: before.authorityRisk,
          authorityAfter: world.authorityRisk,
          actorStandingBefore: before.actorStanding,
          actorStandingAfter: world.standing[entry.agent] ?? null,
          targetStandingBefore: before.targetStanding,
          targetStandingAfter: world.standing[entry.target] ?? null
        };
        entries.push(entry);
        onEvent({ type: 'entry', entry });
        onEvent({ type: 'world', world });
        if (world.resolution !== 'Unresolved') break;
      }
      if (world.resolution !== 'Unresolved') break;
    }
    if (world.resolution === 'Unresolved') world.resolution = `Deadlock — no agreement reached after ${world.round} round${world.round === 1 ? '' : 's'}`;
  } finally {
    await Promise.all([...usedModels].map(unload));
  }
  return { entries, agents: safeAgents, roundsCompleted: world.round, initialWorld, finalWorld: world };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/models') return send(res, 200, { connected: true, models: await installedModels() });
    if (req.method === 'POST' && url.pathname === '/api/simulate') {
      let prepared;
      try {
        prepared = await prepareSimulation(await readJson(req));
      } catch (error) {
        return send(res, 400, { error: error.message || 'Invalid simulation request.' });
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
      const write = payload => res.write(`${JSON.stringify(payload)}\n`);
      try {
        const result = await runSimulation(prepared, write);
        write({ type: 'done', ...result });
      } catch (error) {
        write({ type: 'error', error: error.message || 'Unexpected server error.' });
      }
      return res.end();
    }
    if (req.method === 'GET') {
      const requested = url.pathname === '/' ? '/index.html' : url.pathname;
      const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
      if (!filePath.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
      return fs.createReadStream(filePath).pipe(res);
    }
    send(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    send(res, 500, { error: error.message || 'Unexpected server error.' });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`SocioLab is running at http://127.0.0.1:${PORT}`));
