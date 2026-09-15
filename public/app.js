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
  template: document.querySelector('#agentTemplate'),
  insights: document.querySelector('#insights'),
  analyticsEmpty: document.querySelector('#analyticsEmpty'),
  discussionPanel: document.querySelector('#discussionPanel'),
  analyticsPanel: document.querySelector('#analyticsPanel'),
  tabButtons: document.querySelectorAll('.tab-button')
};

function setActiveTab(tab) {
  elements.discussionPanel.hidden = tab !== 'discussion';
  elements.analyticsPanel.hidden = tab !== 'analytics';
  elements.tabButtons.forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

elements.tabButtons.forEach(button => button.addEventListener('click', () => setActiveTab(button.dataset.tab)));

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

const START_TENSION = 4;
const START_STANDING = 5; // mirrors server.js makeWorldState()'s initial values
const AGENT_COLORS = ['var(--coral)', 'var(--teal)', 'var(--mustard)', 'var(--blue)'];

function buildTimelines(entries, agentNames) {
  const tensionPoints = [{ turn: 0, value: START_TENSION }];
  const standingNow = Object.fromEntries(agentNames.map(name => [name, START_STANDING]));
  const standingSeries = Object.fromEntries(agentNames.map(name => [name, [{ turn: 0, value: START_STANDING }]]));
  const actionCounts = Object.fromEntries(agentNames.map(name => [name, {}]));
  const roundEndTurn = {};
  entries.forEach((entry, i) => {
    const turn = i + 1;
    const prevTension = tensionPoints[tensionPoints.length - 1].value;
    if (entry.effect) {
      tensionPoints.push({ turn, value: entry.effect.tensionAfter });
      if (Object.prototype.hasOwnProperty.call(standingNow, entry.agent)) standingNow[entry.agent] = entry.effect.actorStandingAfter;
      if (Object.prototype.hasOwnProperty.call(standingNow, entry.target)) standingNow[entry.target] = entry.effect.targetStandingAfter;
    } else {
      tensionPoints.push({ turn, value: prevTension });
    }
    agentNames.forEach(name => standingSeries[name].push({ turn, value: standingNow[name] }));
    actionCounts[entry.agent][entry.action] = (actionCounts[entry.agent][entry.action] || 0) + 1;
    roundEndTurn[entry.round] = turn;
  });
  const roundTicks = [{ turn: 0, label: 'Start' }, ...Object.entries(roundEndTurn).map(([round, turn]) => ({ turn, label: `R${round}` }))];
  return { tensionPoints, standingSeries, actionCounts, roundTicks };
}

function svgLinePath(points, x, y) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.turn)},${y(p.value)}`).join(' ');
}

function chartGridAndTicks(x, y, padL, W, padR, H) {
  const gridlines = [0, 2.5, 5, 7.5, 10].map(v => `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" class="chart-grid" /><text x="${padL - 8}" y="${y(v) + 4}" class="chart-tick" text-anchor="end">${v}</text>`).join('');
  return gridlines;
}

function renderTensionChart(tensionPoints, roundTicks) {
  const W = 640, H = 180, padL = 30, padR = 16, padT = 16, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxTurn = tensionPoints[tensionPoints.length - 1].turn || 1;
  const x = t => padL + (t / maxTurn) * innerW;
  const y = v => padT + innerH - (v / 10) * innerH;
  const linePath = svgLinePath(tensionPoints, x, y);
  const areaPath = `${linePath} L${x(tensionPoints[tensionPoints.length - 1].turn)},${y(0)} L${x(0)},${y(0)} Z`;
  const last = tensionPoints[tensionPoints.length - 1];
  const hoverDots = tensionPoints.map(p => `<circle cx="${x(p.turn)}" cy="${y(p.value)}" r="9" fill="transparent"><title>${p.turn === 0 ? 'Start' : `Turn ${p.turn}`}: tension ${p.value}/10</title></circle>`).join('');
  const xTicks = roundTicks.map(t => `<text x="${x(t.turn)}" y="${H - 6}" class="chart-tick" text-anchor="middle">${escapeHtml(t.label)}</text>`).join('');
  const tableRows = tensionPoints.map(p => `<tr><td>${p.turn === 0 ? 'Start' : p.turn}</td><td>${p.value}</td></tr>`).join('');
  return `
    <figure class="chart-figure">
      <figcaption class="chart-title">Social tension timeline</figcaption>
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Line chart of social tension from 0 to 10 across the simulation, ending at ${last.value}">
        ${chartGridAndTicks(x, y, padL, W, padR, H)}
        <path d="${areaPath}" class="chart-area" fill="var(--coral)" stroke="none" />
        <path d="${linePath}" class="chart-line" stroke="var(--coral)" fill="none" />
        <circle cx="${x(last.turn)}" cy="${y(last.value)}" r="5" fill="var(--coral)" stroke="var(--card)" stroke-width="2" />
        <text x="${Math.max(padL, x(last.turn) - 10)}" y="${Math.max(padT + 10, y(last.value) - 10)}" class="chart-endlabel" text-anchor="end">${last.value}/10</text>
        ${hoverDots}
        ${xTicks}
      </svg>
      <details class="chart-table"><summary>View data</summary>
        <table><thead><tr><th>Turn</th><th>Tension</th></tr></thead><tbody>${tableRows}</tbody></table>
      </details>
    </figure>`;
}

function renderStandingChart(standingSeries, agentNames, roundTicks) {
  const W = 640, H = 220, padL = 30, padR = 86, padT = 16, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const anySeries = standingSeries[agentNames[0]];
  const maxTurn = anySeries[anySeries.length - 1].turn || 1;
  const x = t => padL + (t / maxTurn) * innerW;
  const y = v => padT + innerH - (v / 10) * innerH;
  const xTicks = roundTicks.map(t => `<text x="${x(t.turn)}" y="${H - 6}" class="chart-tick" text-anchor="middle">${escapeHtml(t.label)}</text>`).join('');

  const finals = agentNames.map((name, i) => ({ name, i, value: standingSeries[name][standingSeries[name].length - 1].value }));
  finals.sort((a, b) => b.value - a.value);
  let prevY = -Infinity;
  const labelYs = {};
  finals.forEach(f => {
    let ly = y(f.value);
    if (ly - prevY < 14) ly = prevY + 14;
    labelYs[f.name] = ly;
    prevY = ly;
  });

  const seriesSvg = agentNames.map((name, i) => {
    const color = AGENT_COLORS[i % AGENT_COLORS.length];
    const pts = standingSeries[name];
    const path = svgLinePath(pts, x, y);
    const last = pts[pts.length - 1];
    const hoverDots = pts.map(p => `<circle cx="${x(p.turn)}" cy="${y(p.value)}" r="9" fill="transparent"><title>${escapeHtml(name)} — ${p.turn === 0 ? 'start' : `turn ${p.turn}`}: standing ${p.value}/10</title></circle>`).join('');
    return `
      <path d="${path}" class="chart-line" stroke="${color}" fill="none" />
      <circle cx="${x(last.turn)}" cy="${y(last.value)}" r="5" fill="${color}" stroke="var(--card)" stroke-width="2" />
      <text x="${x(last.turn) + 10}" y="${labelYs[name] + 4}" class="chart-endlabel" text-anchor="start">${escapeHtml(name)} ${last.value}</text>
      ${hoverDots}`;
  }).join('');

  const legend = agentNames.map((name, i) => `<span class="chart-legend-item"><span class="chart-swatch" style="background:${AGENT_COLORS[i % AGENT_COLORS.length]}"></span>${escapeHtml(name)}</span>`).join('');
  const tableRows = anySeries.map((_, idx) => {
    const turnLabel = anySeries[idx].turn === 0 ? 'Start' : anySeries[idx].turn;
    const cells = agentNames.map(name => `<td>${standingSeries[name][idx].value}</td>`).join('');
    return `<tr><td>${turnLabel}</td>${cells}</tr>`;
  }).join('');

  return `
    <figure class="chart-figure">
      <figcaption class="chart-title">Agent standing over time</figcaption>
      <div class="chart-legend">${legend}</div>
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Line chart of each participant's standing from 0 to 10 across the simulation">
        ${chartGridAndTicks(x, y, padL, W, padR, H)}
        ${seriesSvg}
        ${xTicks}
      </svg>
      <details class="chart-table"><summary>View data</summary>
        <table><thead><tr><th>Turn</th>${agentNames.map(n => `<th>${escapeHtml(n)}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table>
      </details>
    </figure>`;
}

function renderActionChart(actionCounts, agentNames) {
  const labelW = 96, barW = 150, barH = 14, gap = 8, rowH = barH + gap;
  const cards = agentNames.map((name, i) => {
    const color = AGENT_COLORS[i % AGENT_COLORS.length];
    const rows = Object.entries(actionCounts[name]).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return `<div class="action-card"><div class="action-card-head"><span class="chart-swatch" style="background:${color}"></span><strong>${escapeHtml(name)}</strong></div><p class="muted">No actions yet.</p></div>`;
    const max = rows[0][1];
    const chartH = rows.length * rowH;
    const bars = rows.map(([action, count], idx) => {
      const w = Math.max(6, (count / max) * barW);
      const yPos = idx * rowH;
      return `
        <text x="0" y="${yPos + barH - 3}" class="chart-tick" text-anchor="start">${escapeHtml(action.toUpperCase())}</text>
        <rect x="${labelW}" y="${yPos}" width="${w}" height="${barH}" rx="4" fill="${color}"><title>${escapeHtml(name)} — ${escapeHtml(action)}: ${count}</title></rect>
        <text x="${labelW + w + 6}" y="${yPos + barH - 3}" class="chart-tick" text-anchor="start">${count}</text>`;
    }).join('');
    return `
      <div class="action-card">
        <div class="action-card-head"><span class="chart-swatch" style="background:${color}"></span><strong>${escapeHtml(name)}</strong></div>
        <svg viewBox="0 0 ${labelW + barW + 30} ${chartH}" class="chart-svg action-svg" role="img" aria-label="Bar chart of actions taken by ${escapeHtml(name)}">${bars}</svg>
      </div>`;
  }).join('');
  return `
    <figure class="chart-figure">
      <figcaption class="chart-title">Action distribution per participant</figcaption>
      <div class="action-grid">${cards}</div>
    </figure>`;
}

function renderInsights(entries, agentNames) {
  if (!entries.length) {
    elements.insights.hidden = true;
    elements.insights.innerHTML = '';
    elements.analyticsEmpty.hidden = false;
    return;
  }
  const { tensionPoints, standingSeries, actionCounts, roundTicks } = buildTimelines(entries, agentNames);
  elements.analyticsEmpty.hidden = true;
  elements.insights.hidden = false;
  elements.insights.innerHTML = `${renderTensionChart(tensionPoints, roundTicks)}${renderStandingChart(standingSeries, agentNames, roundTicks)}${renderActionChart(actionCounts, agentNames)}`;
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
  const agentNames = agents.map(agent => agent.name);
  const liveEntries = [];
  elements.transcript.innerHTML = '';
  elements.emptyState.hidden = true;
  elements.worldState.hidden = true;
  renderInsights(liveEntries, agentNames);
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
          liveEntries.push(event.entry);
          renderInsights(liveEntries, agentNames);
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
  elements.insights.hidden = true;
  elements.insights.innerHTML = '';
  elements.analyticsEmpty.hidden = false;
  elements.emptyState.hidden = false;
  elements.runStatus.textContent = 'Ready';
  setActiveTab('discussion');
});
document.querySelector('#loadExample').addEventListener('click', () => { elements.scenario.value = example; });

refreshModels();
