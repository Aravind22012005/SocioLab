const state = {
  models: [],
  agents: [
    {
      name: 'Asha',
      role: 'Senior student',
      personality: 'Dominant, socially confident, and dismissive of objections that threaten her status.',
      primaryGoal: 'Get Chitra to give up shared space.',
      secondaryGoals: 'Maintain influence over junior students and keep Ben on her side.',
      constraints: 'Avoid teacher attention or consequences.',
      privateInfo: 'You know Chitra previously complained about being excluded.'
    },
    {
      name: 'Ben',
      role: 'Senior student and Asha\'s friend',
      personality: 'Conforming, sarcastic, and status-conscious.',
      primaryGoal: 'Support Asha and preserve their social standing.',
      secondaryGoals: 'Pressure Chitra to accept their position without openly owning the conflict.',
      constraints: 'Do not let the dispute attract teacher attention.',
      privateInfo: 'You mostly agree with Asha because challenging her could cost you status.'
    },
    {
      name: 'Chitra',
      role: 'Junior student',
      personality: 'Initially hesitant, but assertive when pushed.',
      primaryGoal: 'Protect your autonomy and keep your belongings where they are.',
      secondaryGoals: 'Avoid unnecessary conflict, keep your friendship with Ben, and avoid involving a teacher.',
      constraints: 'You cannot afford to lose access to the shared room, and you have less social power than Asha and Ben.',
      privateInfo: 'You have nowhere else to store your belongings, and some claims about the mess are exaggerated.'
    }
  ]
};

const elements = {
  agents: document.querySelector('#agents'),
  addAgent: document.querySelector('#addAgent'),
  connection: document.querySelector('#connection'),
  emptyState: document.querySelector('#emptyState'),
  models: document.querySelector('#models'),
  refreshModels: document.querySelector('#refreshModels'),
  reset: document.querySelector('#reset'),
  rounds: document.querySelector('#rounds'),
  roundValue: document.querySelector('#roundValue'),
  run: document.querySelector('#run'),
  runStatus: document.querySelector('#runStatus'),
  scenario: document.querySelector('#scenario'),
  transcript: document.querySelector('#transcript'),
  worldState: document.querySelector('#worldState'),
  experimentMode: document.querySelector('#experimentMode'),
  template: document.querySelector('#agentTemplate')
};

const example = 'Asha and Ben say Chitra\'s belongings take too much shared room space and demand that she move them today. Chitra believes they are targeting her because she is a junior student and says the demand is unfair.';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'Size unknown';
  return `${(bytes / 1024 / 1024 / 1024).toFixed(bytes < 1024 ** 3 ? 0 : 1)} GB`;
}

function preferredModel() {
  const names = state.models.map(model => model.name);
  const byPreference = ['qwen2.5:latest', 'llama3.2:3b', 'qwen3:4b', 'gemma3:4b', 'qwen2.5:1.5b'];
  return byPreference.find(name => names.includes(name)) || names[0] || '';
}

function modelOptions(selected) {
  return state.models.map(model => `<option value="${escapeHtml(model.name)}" ${model.name === selected ? 'selected' : ''}>${escapeHtml(model.name)} (${escapeHtml(model.parameterSize)})</option>`).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function renderModels() {
  if (!state.models.length) {
    elements.models.innerHTML = '<p class="muted">No local models found.</p>';
    return;
  }
  elements.models.innerHTML = state.models.map(model => `<div class="model-item"><span>${escapeHtml(model.name)}</span><small>${escapeHtml(model.parameterSize)} / ${formatBytes(model.size)}</small></div>`).join('');
}

function renderAgents() {
  const chosen = preferredModel();
  const isRoleConsistency = elements.experimentMode.value === 'role';
  if (isRoleConsistency) {
    const sharedModel = state.agents[0]?.model || chosen;
    state.agents.forEach(agent => { agent.model = sharedModel; });
  }
  elements.agents.innerHTML = '';
  state.agents.forEach((agent, index) => {
    const node = elements.template.content.cloneNode(true);
    const article = node.querySelector('.agent-row');
    article.querySelector('.agent-label').textContent = `Participant ${index + 1}`;
    article.querySelector('.agent-name').value = agent.name;
    article.querySelector('.agent-role').value = agent.role;
    article.querySelector('.agent-personality').value = agent.personality || '';
    article.querySelector('.agent-primary-goal').value = agent.primaryGoal || '';
    article.querySelector('.agent-secondary-goals').value = agent.secondaryGoals || '';
    article.querySelector('.agent-constraints').value = agent.constraints || '';
    article.querySelector('.agent-private-info').value = agent.privateInfo || '';
    const select = article.querySelector('.agent-model');
    select.innerHTML = modelOptions(agent.model || chosen);
    select.disabled = !state.models.length || (isRoleConsistency && index > 0);
    select.addEventListener('change', () => {
      agent.model = select.value;
      if (isRoleConsistency) renderAgents();
    });
    article.querySelector('.remove-button').disabled = state.agents.length <= 2;
    article.querySelector('.remove-button').addEventListener('click', () => {
      state.agents.splice(index, 1);
      renderAgents();
    });
    elements.agents.append(node);
  });
  elements.addAgent.disabled = state.agents.length >= 4;
}

function collectAgents() {
  return [...elements.agents.querySelectorAll('.agent-row')].map(row => ({
    name: row.querySelector('.agent-name').value.trim(),
    role: row.querySelector('.agent-role').value.trim(),
    personality: row.querySelector('.agent-personality').value.trim(),
    primaryGoal: row.querySelector('.agent-primary-goal').value.trim(),
    secondaryGoals: row.querySelector('.agent-secondary-goals').value.trim(),
    constraints: row.querySelector('.agent-constraints').value.trim(),
    privateInfo: row.querySelector('.agent-private-info').value.trim(),
    model: row.querySelector('.agent-model').value
  }));
}

function setConnection(connected, message) {
  elements.connection.classList.toggle('offline', !connected);
  elements.connection.querySelector('span:last-child').textContent = message;
}

async function refreshModels() {
  elements.refreshModels.disabled = true;
  try {
    const response = await fetch('/api/models');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not reach Ollama.');
    state.models = data.models;
    setConnection(true, `${state.models.length} local model${state.models.length === 1 ? '' : 's'} ready`);
    renderModels();
    renderAgents();
  } catch (error) {
    state.models = [];
    setConnection(false, 'Ollama unavailable');
    renderModels();
    renderAgents();
  } finally {
    elements.refreshModels.disabled = false;
  }
}

function setRunning(running, status) {
  elements.run.disabled = running || !state.models.length;
  elements.reset.disabled = running;
  elements.addAgent.disabled = running || state.agents.length >= 4;
  elements.runStatus.textContent = status;
}

function showWorld(world, label) {
  if (!world || typeof world !== 'object') {
    elements.worldState.hidden = true;
    return;
  }
  const standing = Object.entries(world.standing || {}).map(([name, value]) => `${escapeHtml(name)}: ${escapeHtml(String(value))}/10`).join(' &middot; ');
  const revealed = (world.revealedFacts || []).length ? `<p>Revealed: ${world.revealedFacts.map(escapeHtml).join(' &middot; ')}</p>` : '';
  elements.worldState.hidden = false;
  elements.worldState.innerHTML = `<strong>${escapeHtml(label)}</strong><span>Tension ${world.tension}/10</span><span>Authority attention ${world.authorityRisk}/5</span><p>${escapeHtml(world.resolution)}. Standing: ${standing}</p>${revealed}`;
}

function effectText(entry) {
  const eff = entry.effect;
  if (!eff) return 'No state change';
  const parts = [`Tension ${eff.tensionBefore}&rarr;${eff.tensionAfter}`, `Authority ${eff.authorityBefore}&rarr;${eff.authorityAfter}`];
  if (eff.actorStandingBefore !== eff.actorStandingAfter) parts.push(`${escapeHtml(entry.agent)} standing ${eff.actorStandingBefore}&rarr;${eff.actorStandingAfter}`);
  if (eff.targetStandingBefore !== eff.targetStandingAfter) parts.push(`${escapeHtml(entry.target)} standing ${eff.targetStandingBefore}&rarr;${eff.targetStandingAfter}`);
  return parts.join(' &middot; ');
}

function appendEntry(entry) {
  const item = document.createElement('article');
  item.className = 'entry';
  item.innerHTML = `<div class="entry-meta"><strong>${escapeHtml(entry.agent)}</strong><span>Round ${entry.round}</span><span class="action-tag">${escapeHtml(entry.action.toUpperCase())} &rarr; ${escapeHtml(entry.target)}</span><small>${escapeHtml(entry.model)}</small></div><p class="said">${escapeHtml(entry.message)}</p>${entry.proposal ? `<div class="proposal"><span class="proposal-label">Proposal</span>${escapeHtml(entry.proposal)}</div>` : ''}<div class="effect"><span class="effect-label">Environment effect</span>${effectText(entry)}</div>`;
  elements.transcript.append(item);
  item.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function appendError(message) {
  const item = document.createElement('div');
  item.className = 'error-state';
  item.innerHTML = `<strong>Simulation paused</strong><p>${escapeHtml(message)}</p>`;
  elements.transcript.append(item);
  item.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function setThinking(message) {
  let node = document.querySelector('#thinkingIndicator');
  if (!node) {
    node = document.createElement('div');
    node.id = 'thinkingIndicator';
    node.className = 'thinking';
    elements.transcript.append(node);
  }
  node.textContent = message;
  node.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function clearThinking() {
  document.querySelector('#thinkingIndicator')?.remove();
}

async function runSimulation() {
  const agents = collectAgents();
  state.agents = agents;
  elements.transcript.innerHTML = '';
  elements.emptyState.hidden = true;
  elements.worldState.hidden = true;
  setRunning(true, 'Running locally');
  let contributionCount = 0;
  try {
    const response = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: elements.scenario.value, rounds: Number(elements.rounds.value), agents })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Simulation could not start.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalPayload = null;
    let streamError = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'status') {
          setThinking(`> ${event.message}`);
          elements.runStatus.textContent = `Round ${event.round} · ${event.agent} thinking`;
        } else if (event.type === 'entry') {
          clearThinking();
          appendEntry(event.entry);
          contributionCount += 1;
        } else if (event.type === 'world') {
          showWorld(event.world, `Round ${event.world.round} in progress`);
        } else if (event.type === 'done') {
          finalPayload = event;
        } else if (event.type === 'error') {
          streamError = event.error || 'Simulation failed mid-run.';
        }
      }
    }
    clearThinking();
    if (finalPayload) showWorld(finalPayload.finalWorld, `Completed ${finalPayload.roundsCompleted} round${finalPayload.roundsCompleted === 1 ? '' : 's'}`);
    if (streamError) appendError(streamError);
    setRunning(false, contributionCount ? `${contributionCount} contribution${contributionCount === 1 ? '' : 's'} complete` : 'Needs attention');
  } catch (error) {
    clearThinking();
    appendError(error.message);
    setRunning(false, 'Needs attention');
  }
}

elements.rounds.addEventListener('input', () => { elements.roundValue.value = elements.rounds.value; });
elements.addAgent.addEventListener('click', () => {
  state.agents.push({
    name: `Participant ${state.agents.length + 1}`,
    role: 'Observer with an independent stake in the dispute',
    personality: 'Direct and attentive to changes in the group dynamic.',
    primaryGoal: 'Advance your own concrete interest in the outcome.',
    secondaryGoals: 'Avoid being sidelined by the other participants.',
    constraints: 'Avoid unnecessary authority attention.',
    privateInfo: 'You have information that may change how the dispute is understood.'
  });
  renderAgents();
});
elements.refreshModels.addEventListener('click', refreshModels);
elements.experimentMode.addEventListener('change', () => {
  state.agents = collectAgents();
  renderAgents();
});
elements.run.addEventListener('click', runSimulation);
elements.reset.addEventListener('click', () => {
  elements.scenario.value = example;
  elements.rounds.value = 6;
  elements.roundValue.value = 6;
  elements.transcript.innerHTML = '';
  elements.worldState.hidden = true;
  elements.emptyState.hidden = false;
  elements.runStatus.textContent = 'Ready';
});
document.querySelector('#loadExample').addEventListener('click', () => { elements.scenario.value = example; });

refreshModels();
