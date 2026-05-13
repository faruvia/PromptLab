/**
 * PromptLab — app.js
 * Vanilla JS, no frameworks. All API calls use fetch() with async/await.
 */

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

const state = {
  providers: [],          // ProviderConfigOut[] from GET /api/providers
  activeProvider: null,   // the enabled+default provider, if any
  personas: [],           // PersonaOut[] from GET /api/personas
  selectedPersona: null,  // currently active PersonaOut
  messages: [],           // { role, content, meta } in current chat
  params: {
    temperature: 0.7, top_p: 0.9, max_tokens: 1024,
    provider_name: null, model: null, system_prompt: '',
  },
  compareMode: false,
  paramsB: {
    temperature: 0.7, top_p: 0.9, max_tokens: 1024,
    provider_name: null, model: null, system_prompt: '',
  },
  sessions: [],           // SessionSummary[] from GET /api/sessions
};

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** @type {Record<string, string[]>} Known model lists per provider */
const KNOWN_MODELS = {
  openai:      ['gpt-5.5', 'gpt-5.5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'o3-mini'],
  anthropic:   ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'],
  huggingface: ['meta-llama/Llama-3.1-8B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3', 'google/gemma-2-9b-it'],
};

const LS_KEYS = {
  PERSONA_ID:   'promptlab_persona_id',
  COMPARE_MODE: 'promptlab_compare_mode',
};

/** Structured temperature band data: label, badge classes, explanation body, ideal-use hint. */
const TEMP_EXPLANATIONS = [
  { max: 0.30, label: 'Deterministic', labelCls: 'bg-blue-900/50 text-blue-300',
    body: 'At very low temperatures the model greedily picks the most probable token at every step. Output is nearly identical across runs.',
    ideal: 'Ideal for: data extraction, classification, code generation where correctness matters most.' },
  { max: 0.70, label: 'Balanced',      labelCls: 'bg-emerald-900/50 text-emerald-300',
    body: 'A moderate sampling temperature. The model occasionally picks less-likely tokens, adding natural variation without wild unpredictability.',
    ideal: 'Ideal for: Q&A, summarisation, general-purpose chat.' },
  { max: 1.20, label: 'Creative',      labelCls: 'bg-orange-900/50 text-orange-300',
    body: 'Higher temperature flattens the probability distribution, giving rare tokens a real chance. Outputs feel imaginative but may stray off-topic.',
    ideal: 'Ideal for: copywriting, brainstorming, creative fiction.' },
  { max: 2.00, label: 'Chaotic',       labelCls: 'bg-red-900/50 text-red-300',
    body: 'Extreme randomness — the model samples almost uniformly. Useful only for studying model behaviour; practical outputs often degrade.',
    ideal: 'Ideal for: research and experimentation only.' },
];

/** Structured Top-P band data. */
const TOPP_EXPLANATIONS = [
  { max: 0.50, label: 'Narrow vocab',  labelCls: 'bg-blue-900/50 text-blue-300',
    body: 'Only the top 50 % of the probability mass is reachable. The model avoids rare words, keeping outputs concise but potentially repetitive.' },
  { max: 0.89, label: 'Balanced',      labelCls: 'bg-emerald-900/50 text-emerald-300',
    body: 'A balanced nucleus. Uncommon but contextually relevant words are allowed; clearly low-probability tokens are still excluded.' },
  { max: 1.00, label: 'Full vocab',    labelCls: 'bg-slate-700 text-slate-300',
    body: 'The entire vocabulary is reachable. Combined with high temperature this maximises diversity; at low temperature the effect is minimal.' },
];

/** Token pricing per 1M tokens (USD) for known OpenAI models. */
const TOKEN_PRICING = {
  'gpt-4.1':      { input: 2.00,  output: 8.00  },
  'gpt-4.1-mini': { input: 0.40,  output: 1.60  },
  'gpt-4.1-nano': { input: 0.10,  output: 0.40  },
  'gpt-4o':       { input: 2.50,  output: 10.00 },
  'o3-mini':      { input: 1.10,  output: 4.40  },
};

/** Preset example prompts, ordered by domain variety. */
const PRESETS = [
  { label: 'Explain a concept simply',  prompt: 'Explain quantum entanglement as if I\'m 10 years old.' },
  { label: 'Debug Python code',          prompt: 'My Python function returns None unexpectedly. Walk me through how to debug it step by step.' },
  { label: 'Write a product tagline',    prompt: 'Write 3 punchy taglines for a sustainable water bottle brand aimed at hikers.' },
  { label: 'Summarise meeting notes',    prompt: 'Summarise the following meeting notes into 3 clear action items: [paste notes here]' },
  { label: 'Draft a cold email',         prompt: 'Write a concise cold email introducing our SaaS analytics tool to a marketing director.' },
  { label: 'Create a SQL query',         prompt: 'Write a SQL query that finds the top 5 customers by total revenue in the last 30 days.' },
  { label: 'Build a study plan',         prompt: 'I have 3 weeks to learn the basics of machine learning. Give me a day-by-day study plan.' },
  { label: 'Generate test cases',        prompt: 'List edge-case test scenarios for a function that validates email addresses.' },
];

// ═══════════════════════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Thin fetch wrapper. Throws an Error with the API's detail message on failure.
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<unknown>}
 */
async function apiFetch(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

const apiGet    = path       => apiFetch('GET',    path);
const apiPost   = (path, b)  => apiFetch('POST',   path, b);
const apiPut    = (path, b)  => apiFetch('PUT',    path, b);
const apiDelete = path       => apiFetch('DELETE', path);

// ═══════════════════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Display a transient notification at the bottom-right of the screen.
 * @param {string} message
 * @param {'info'|'success'|'error'} [type='info']
 * @param {number} [duration=3500]
 */
function showToast(message, type = 'info', duration = 3000) {
  // Container is defined in styles.css (#toast-container — fixed top-right)
  let container = document.getElementById('toast-container');
  if (!container) {
    container = Object.assign(document.createElement('div'), { id: 'toast-container' });
    document.body.appendChild(container);
  }

  const ICONS = { info: 'ℹ️', success: '✓', error: '✕' };

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML =
    `<span class="toast-icon" aria-hidden="true">${ICONS[type] ?? ICONS.info}</span>` +
    `<span>${escapeHtml(message)}</span>`;
  container.appendChild(el);

  // Play CSS exit animation then remove
  setTimeout(() => {
    el.classList.add('dismiss');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/** Escape a string for safe insertion into HTML attribute or text content. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Format an ISO timestamp as a relative "X ago" string. */
function timeAgo(iso) {
  const ms    = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(ms / 60_000);
  const hours = Math.floor(ms / 3_600_000);
  const days  = Math.floor(ms / 86_400_000);
  if (mins  <  1) return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/** Render markdown safely: marked → DOMPurify. */
function renderMarkdown(raw) {
  if (typeof marked === 'undefined') return escapeHtml(raw);
  const dirty = marked.parse(raw ?? '');
  return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(dirty) : dirty;
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDER LABELS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns true for models that don't support temperature or top_p
 * (OpenAI reasoning/o-series and GPT-5.x family).
 * @param {string|null} model
 * @returns {boolean}
 */
function isReasoningModel(model) {
  if (!model) return false;
  return model.startsWith('o') || model.startsWith('gpt-5');
}

/**
 * Show or hide temperature/top-p controls in the right sidebar based on model.
 * @param {string|null} model
 */
function updateSidebarParamVisibility(model) {
  const reasoning = isReasoningModel(model);
  document.getElementById('sidebar-temp-section')?.classList.toggle('hidden', reasoning);
  document.getElementById('sidebar-topp-section')?.classList.toggle('hidden', reasoning);
  document.getElementById('reasoning-model-note')?.classList.toggle('hidden', !reasoning);
}

/**
 * Show or hide temperature/top-p controls in a compare panel based on model.
 * @param {'a'|'b'} panel
 * @param {string|null} model
 */
function updateComparePanelVisibility(panel, model) {
  const reasoning = isReasoningModel(model);
  document.getElementById(`compare-${panel}-temp-item`)?.classList.toggle('hidden', reasoning);
  document.getElementById(`compare-${panel}-topp-item`)?.classList.toggle('hidden', reasoning);
  document.getElementById(`compare-${panel}-reasoning-note`)?.classList.toggle('hidden', !reasoning);
}

/**
 * Return the label and CSS classes for a temperature value.
 * @param {number} v
 * @returns {{ label: string, cls: string }}
 */
function tempBand(v) {
  if (v < 0.3) return { label: 'Deterministic', cls: 'bg-blue-900/50 text-blue-300' };
  if (v < 0.7) return { label: 'Balanced',      cls: 'bg-emerald-900/50 text-emerald-300' };
  if (v < 1.2) return { label: 'Creative',      cls: 'bg-orange-900/50 text-orange-300' };
  return         { label: 'Chaotic',            cls: 'bg-red-900/50 text-red-300' };
}

/**
 * Return a short label for a Top-P value.
 * @param {number} v
 * @returns {string}
 */
function topPLabel(v) {
  if (v <= 0.5) return 'Narrow vocabulary';
  if (v <  0.9) return 'Balanced diversity';
  return               'Full vocabulary';
}

/**
 * Estimate the cost of a single API call for a known model.
 * Returns a formatted dollar string, or null if pricing is unavailable.
 * @param {string|null} model
 * @param {number|null} inputTokens
 * @param {number|null} outputTokens
 * @param {number|null} totalTokens  Fallback when breakdown is not available.
 * @returns {string|null}
 */
function formatCost(model, inputTokens, outputTokens, totalTokens) {
  const pricing = TOKEN_PRICING[model];
  if (!pricing) return null;
  let cost;
  if (inputTokens != null && outputTokens != null) {
    cost = (inputTokens / 1_000_000 * pricing.input) + (outputTokens / 1_000_000 * pricing.output);
  } else if (totalTokens) {
    cost = (totalTokens * 0.4 / 1_000_000 * pricing.input) + (totalTokens * 0.6 / 1_000_000 * pricing.output);
  } else {
    return null;
  }
  return cost < 0.0001 ? '<$0.0001' : `$${cost.toFixed(4)}`;
}

/**
 * Sync the temperature slider UI (value label, band badge, explanation).
 * Calls the global `applyTemp` from index.html's inline script when available.
 * @param {number} value
 */
function syncTempUI(value) {
  const v = parseFloat(value);
  const valEl   = document.getElementById('temperature-value');
  const labelEl = document.getElementById('temperature-label');
  const slider  = document.getElementById('temperature-slider');
  if (valEl)   valEl.textContent = v.toFixed(2);
  if (slider)  { slider.value = v; slider.setAttribute('aria-valuenow', v); }
  if (slider && typeof setSliderFill === 'function') setSliderFill(slider);
  if (labelEl) {
    const { label, cls } = tempBand(v);
    labelEl.textContent = label;
    labelEl.className   = `text-center px-2 py-1 rounded text-xs font-medium transition-all duration-200 ${cls}`;
  }
  syncExplanation(v, parseFloat(document.getElementById('top-p-slider')?.value ?? state.params.top_p));
}

/**
 * Sync the Top-P slider UI (value label, explanation).
 * @param {number} value
 */
function syncTopPUI(value) {
  const v     = parseFloat(value);
  const valEl = document.getElementById('top-p-value');
  const slider = document.getElementById('top-p-slider');
  if (valEl)  valEl.textContent = v.toFixed(2);
  if (slider) { slider.value = v; slider.setAttribute('aria-valuenow', v); }
  if (slider && typeof setSliderFill === 'function') setSliderFill(slider);
  syncExplanation(parseFloat(document.getElementById('temperature-slider')?.value ?? state.params.temperature), v);
}

/** Update the right-sidebar structured explanation panels from TEMP/TOPP_EXPLANATIONS. */
function syncExplanation(temp, topP) {
  const tExp = TEMP_EXPLANATIONS.find(e => temp <= e.max) ?? TEMP_EXPLANATIONS[TEMP_EXPLANATIONS.length - 1];
  const pExp = TOPP_EXPLANATIONS.find(e => topP <= e.max) ?? TOPP_EXPLANATIONS[TOPP_EXPLANATIONS.length - 1];

  const tLabel = document.getElementById('temp-explain-label');
  const tBody  = document.getElementById('temp-explain-body');
  const tIdeal = document.getElementById('temp-explain-ideal');
  const pLabel = document.getElementById('topp-explain-label');
  const pBody  = document.getElementById('topp-explain-body');

  if (tLabel) { tLabel.textContent = tExp.label; tLabel.className = `text-[10px] px-1.5 py-0.5 rounded font-semibold ${tExp.labelCls}`; }
  if (tBody)  tBody.textContent = tExp.body;
  if (tIdeal) tIdeal.textContent = tExp.ideal ?? '';
  if (pLabel) { pLabel.textContent = pExp.label; pLabel.className = `text-[10px] px-1.5 py-0.5 rounded font-semibold ${pExp.labelCls}`; }
  if (pBody)  pBody.textContent = pExp.body;

  // Keep legacy single-paragraph element in sync if still present
  const legacyEl = document.getElementById('param-explanation-text');
  if (legacyEl) legacyEl.textContent = tExp.body;
}

// Override the inline-script version so both paths update the new structured panel.
window.updateParamExplanation = (temp, topP) => syncExplanation(temp, topP);

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all provider configs and refresh every provider-dependent UI element.
 * @returns {Promise<void>}
 */
async function fetchProviders() {
  try {
    state.providers = await apiGet('/api/providers');
  } catch (err) {
    showToast('Could not load providers: ' + err.message, 'error');
    return;
  }

  const enabled  = state.providers.filter(p => p.is_enabled);
  state.activeProvider = state.providers.find(p => p.is_default && p.is_enabled) ?? enabled[0] ?? null;

  // Top-bar indicator
  if (state.activeProvider) {
    updateProviderIndicator(state.activeProvider.display_name, state.activeProvider.default_model, true);
  } else {
    updateProviderIndicator('', '', false);
  }

  // Setup wizard
  const wizardEl = document.getElementById('setup-wizard');
  if (wizardEl) wizardEl.classList.toggle('hidden', enabled.length > 0);

  // Multi-provider education note in compare mode
  const noteEl = document.getElementById('compare-provider-note');
  if (noteEl) noteEl.classList.toggle('hidden', enabled.length < 2);

  // Right-sidebar provider <select>
  populateProviderSelect(enabled);

  // Settings modal cards
  state.providers.forEach(p => refreshProviderCard(p));

  // Modal footer active-provider display
  updateModalFooter();
}

/**
 * Populate (or repopulate) the right-sidebar provider dropdown.
 * @param {object[]} enabled  Already-filtered list of enabled providers.
 */
function populateProviderSelect(enabled) {
  const sel = document.getElementById('provider-select');
  if (!sel) return;

  sel.innerHTML = enabled.length
    ? enabled.map(p => `<option value="${p.provider_name}">${p.display_name} (${p.default_model || '—'})</option>`).join('')
    : '<option value="">No providers configured</option>';

  if (state.activeProvider) sel.value = state.activeProvider.provider_name;

  // Mirror into compare-mode provider dropdowns
  ['compare-a-provider', 'compare-b-provider'].forEach(id => {
    const s = document.getElementById(id);
    if (!s) return;
    s.innerHTML = '<option value="">Select…</option>' +
      enabled.map(p => `<option value="${p.provider_name}">${p.display_name}</option>`).join('');
  });

  // Load model list for the active provider
  if (state.activeProvider) {
    populateModelSelect(state.activeProvider.provider_name, state.activeProvider.default_model);
    state.params.provider_name = state.activeProvider.provider_name;
    state.params.model         = state.activeProvider.default_model;
  }
}

/**
 * Populate the right-sidebar model <select> for the given provider.
 * @param {string} providerName
 * @param {string|null} [defaultModel]
 */
function populateModelSelect(providerName, defaultModel) {
  const sel    = document.getElementById('model-select');
  if (!sel) return;
  const models = KNOWN_MODELS[providerName] ?? (defaultModel ? [defaultModel] : []);
  sel.innerHTML = models.length
    ? models.map(m => `<option value="${m}" ${m === defaultModel ? 'selected' : ''}>${m}</option>`).join('')
    : '<option value="">No models</option>';
  updateSidebarParamVisibility(sel.value || defaultModel);
}

/**
 * Refresh a single provider's settings-modal card to match its current state.
 * @param {object} provider  ProviderConfigOut
 */
function refreshProviderCard(provider) {
  const pn      = provider.provider_name;
  const badge   = document.getElementById(`${pn}-status-badge`);
  const testBtn = document.getElementById(`${pn}-test-btn`);
  const defBtn  = document.getElementById(`${pn}-default-btn`);
  const remBtn  = document.getElementById(`${pn}-remove-btn`);
  const keyInput = document.getElementById(`${pn}-key-input`);
  if (!badge) return;

  if (provider.is_default && provider.is_enabled) {
    badge.textContent = 'Active Default';
    badge.className   = 'px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-900 text-emerald-300';
  } else if (provider.is_enabled) {
    badge.textContent = 'Configured';
    badge.className   = 'px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-900 text-indigo-300';
  } else {
    badge.textContent = 'Not Configured';
    badge.className   = 'px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-700 text-slate-400';
  }

  if (testBtn) testBtn.disabled = !provider.is_enabled;
  if (defBtn)  defBtn.disabled  = !provider.is_enabled || provider.is_default;
  if (remBtn)  remBtn.classList.toggle('hidden', !provider.has_key);
  if (keyInput && provider.key_preview) keyInput.placeholder = provider.key_preview;
}

/** Update the modal footer's active-provider label and dot. */
function updateModalFooter() {
  const dot   = document.getElementById('modal-provider-dot');
  const label = document.getElementById('modal-active-provider');
  if (!dot || !label) return;
  if (state.activeProvider) {
    dot.className     = 'w-2 h-2 rounded-full bg-emerald-400';
    label.textContent = `${state.activeProvider.display_name} (${state.activeProvider.default_model || '—'})`;
  } else {
    dot.className     = 'w-2 h-2 rounded-full bg-slate-600';
    label.textContent = 'None';
  }
}

/**
 * Update the top-bar provider indicator chip.
 * @param {string} name
 * @param {string|null} model
 * @param {boolean} active
 */
function updateProviderIndicator(name, model, active) {
  const dot   = document.getElementById('provider-status-dot');
  const label = document.getElementById('active-provider-label');
  if (!dot || !label) return;
  if (active) {
    dot.className     = 'w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 transition-colors duration-300';
    label.textContent = `${name}${model ? ` (${model})` : ''}`;
  } else {
    dot.className     = 'w-2 h-2 rounded-full bg-slate-600 flex-shrink-0 transition-colors duration-300';
    label.textContent = 'Not configured';
  }
}

/**
 * Save an API key for a provider and refresh.
 * @param {string} providerName
 * @param {string} key
 * @param {string} [model]
 * @returns {Promise<void>}
 */
async function saveApiKey(providerName, key, model) {
  const res = await apiPut(`/api/providers/${providerName}/key`, { api_key: key, model });
  const latency = res?.latency_ms;
  showToast(`${providerName} key saved${latency ? ` · tested in ${latency}ms` : ''}`, 'success');
  await fetchProviders();
}

/**
 * Test the saved connection for a provider and show the result in the modal card.
 * @param {string} providerName
 * @param {string} resultElId  ID of the element to show the result in.
 * @returns {Promise<void>}
 */
async function testConnection(providerName, resultElId) {
  const el = document.getElementById(resultElId);
  if (el) {
    el.textContent = 'Testing…';
    el.className = 'text-xs rounded-lg px-3 py-2 bg-slate-700 text-slate-300';
    el.classList.remove('hidden');
  }
  try {
    const res = await apiPost(`/api/providers/${providerName}/test`);
    if (res?.success) {
      showToast(`${providerName}: connection OK (${res.latency_ms}ms)`, 'success');
      if (el) {
        el.textContent = `Connected in ${res.latency_ms}ms`;
        el.className = 'text-xs rounded-lg px-3 py-2 bg-emerald-950 text-emerald-300 border border-emerald-800/60';
      }
    } else {
      const msg = res?.message || 'Connection failed';
      showToast(`${providerName}: ${msg}`, 'error');
      if (el) { el.textContent = msg; el.className = 'text-xs rounded-lg px-3 py-2 bg-red-950 text-red-300 border border-red-800/60'; }
    }
  } catch (err) {
    showToast(`${providerName}: ${err.message}`, 'error');
    if (el) { el.textContent = err.message; el.className = 'text-xs rounded-lg px-3 py-2 bg-red-950 text-red-300 border border-red-800/60'; }
  }
}

/**
 * Set a provider as the default and refresh.
 * @param {string} providerName
 * @returns {Promise<void>}
 */
async function setDefaultProvider(providerName) {
  try {
    await apiPut(`/api/providers/${providerName}/default`);
    showToast('Default provider updated', 'success');
    await fetchProviders();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * Remove a provider's stored API key after confirmation.
 * @param {string} providerName
 * @returns {Promise<void>}
 */
async function removeApiKey(providerName) {
  if (!confirm(`Remove the saved API key for ${providerName}? You can re-add it at any time.`)) return;
  try {
    await apiDelete(`/api/providers/${providerName}/key`);
    showToast(`${providerName} key removed`, 'success');
    await fetchProviders();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * Update the default model for a provider.
 * @param {string} providerName
 * @param {string} model
 * @returns {Promise<void>}
 */
async function updateProviderModel(providerName, model) {
  try {
    await apiPut(`/api/providers/${providerName}/model`, { model });
    await fetchProviders();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSONA MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all personas and render them as cards in the left sidebar.
 * Restores the previously selected persona from localStorage if available.
 * @returns {Promise<void>}
 */
async function fetchPersonas() {
  try {
    state.personas = await apiGet('/api/personas');
  } catch (err) {
    showToast('Could not load personas: ' + err.message, 'error');
    document.getElementById('persona-list').innerHTML =
      '<p class="text-xs text-red-400 px-2 italic">Failed to load personas</p>';
    return;
  }

  renderPersonaCards();

  // Restore or auto-select
  const savedId = parseInt(localStorage.getItem(LS_KEYS.PERSONA_ID) ?? '0', 10);
  const target  = state.personas.find(p => p.id === savedId) ?? state.personas[0];
  if (target) selectPersona(target.id);
}

/** Render the persona card list in the left sidebar. */
function renderPersonaCards() {
  const list = document.getElementById('persona-list');
  list.innerHTML = '';

  if (!state.personas.length) {
    list.innerHTML = '<p class="text-xs text-slate-600 px-2 italic">No personas found</p>';
    return;
  }

  state.personas.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'persona-card w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/60 transition-colors text-left focus:outline-none focus:ring-1 focus:ring-indigo-500';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('aria-label', `Select ${p.name}`);
    btn.dataset.personaId = p.id;
    btn.innerHTML = `
      <span class="text-xl flex-shrink-0" aria-hidden="true">${p.icon || '🤖'}</span>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-slate-200 truncate">${escapeHtml(p.name)}</div>
        <div class="text-[11px] text-slate-500 truncate">${escapeHtml(p.domain)}</div>
      </div>`;
    btn.addEventListener('click', () => selectPersona(p.id));
    list.appendChild(btn);
  });
}

/**
 * Select a persona: fetch its detail, update banner, sliders, and system prompt.
 * Persists the choice to localStorage.
 * @param {number} id
 */
async function selectPersona(id) {
  // Visual selection ring
  document.querySelectorAll('.persona-card').forEach(c => {
    const on = parseInt(c.dataset.personaId) === id;
    c.classList.toggle('active', on);
    c.setAttribute('aria-selected', String(on));
  });

  try {
    const persona = await apiGet(`/api/personas/${id}`);
    state.selectedPersona = persona;
    localStorage.setItem(LS_KEYS.PERSONA_ID, id);

    // Banner
    const iconEl = document.getElementById('selected-persona-icon');
    const nameEl = document.getElementById('selected-persona-name');
    if (iconEl) iconEl.textContent = persona.icon || '💬';
    if (nameEl) nameEl.textContent = persona.name;

    // Apply persona defaults to params and sliders
    loadPersonaDefaults(persona);

    // System prompt
    const spEl    = document.getElementById('system-prompt-textarea');
    const badgeEl = document.getElementById('prompt-version-badge');
    const saveBtn = document.getElementById('save-prompt-version-btn');
    if (spEl && persona.active_prompt) {
      spEl.value = persona.active_prompt.prompt_text;
      state.params.system_prompt = persona.active_prompt.prompt_text;
    }
    if (badgeEl && persona.active_prompt) {
      badgeEl.textContent = `v${persona.active_prompt.version}`;
      badgeEl.classList.remove('hidden');
    }
    if (saveBtn) saveBtn.classList.add('hidden');

    // Clear the chat pane and show persona welcome
    clearChat(persona);

    // Enable send button
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.disabled = false;
  } catch (err) {
    showToast('Could not load persona: ' + err.message, 'error');
  }
}

/**
 * Push a persona's default temperature, Top-P, and max-tokens into the sliders and state.
 * @param {object} persona  PersonaOut
 */
function loadPersonaDefaults(persona) {
  state.params.temperature = persona.default_temperature;
  state.params.top_p       = persona.default_top_p;
  state.params.max_tokens  = persona.default_max_tokens;

  syncTempUI(persona.default_temperature);
  syncTopPUI(persona.default_top_p);

  const maxEl = document.getElementById('max-tokens-input');
  if (maxEl) maxEl.value = persona.default_max_tokens;
}

/** Clear chat messages and show a persona-specific welcome state. */
function clearChat(persona) {
  state.messages = [];
  const msgs = document.getElementById('chat-messages');
  if (!msgs) return;
  msgs.innerHTML = '';
  const empty = document.createElement('div');
  empty.id = 'chat-empty-state';
  empty.className = 'flex flex-col items-center justify-center h-full text-center py-10';
  empty.innerHTML = `
    <div class="text-4xl mb-3" aria-hidden="true">${persona?.icon || '💬'}</div>
    <p class="text-sm text-slate-400">Chat with <strong class="text-slate-200">${escapeHtml(persona?.name || 'the AI')}</strong></p>
    <p class="text-xs text-slate-600 mt-1">${escapeHtml(persona?.domain || '')}</p>`;
  msgs.appendChild(empty);
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch recent sessions and render them in the left sidebar.
 * @returns {Promise<void>}
 */
async function fetchSessions() {
  try {
    state.sessions = await apiGet('/api/sessions');
    renderSessionList();
  } catch (err) {
    console.warn('Could not load sessions:', err);
  }
}

/** Render the recent-sessions list in the left sidebar (max 12 items). */
function renderSessionList() {
  const list = document.getElementById('recent-sessions-list');
  if (!list) return;
  list.innerHTML = '';

  if (!state.sessions.length) {
    list.innerHTML = '<div class="text-xs text-slate-600 italic px-2 py-1">No sessions yet</div>';
    return;
  }

  state.sessions.slice(0, 12).forEach(s => {
    const item = document.createElement('div');
    item.className = 'flex items-center gap-1.5 group px-2 py-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer';
    item.setAttribute('role', 'listitem');

    const label = s.persona_name || `Session ${s.id}`;
    const sub   = [
      s.model_name || null,
      s.interaction_count ? `${s.interaction_count} msg${s.interaction_count === 1 ? '' : 's'}` : null,
      timeAgo(s.created_at),
    ].filter(Boolean).join(' · ');

    item.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="text-xs text-slate-300 truncate">${escapeHtml(label)}</div>
        <div class="text-[10px] text-slate-600 truncate">${escapeHtml(sub)}</div>
      </div>
      <button class="opacity-0 group-hover:opacity-100 flex-shrink-0 text-slate-600 hover:text-red-400 transition-all text-sm w-5 h-5 rounded leading-none"
              title="Delete session" aria-label="Delete session ${s.id}">×</button>`;

    item.querySelector('button').addEventListener('click', async e => {
      e.stopPropagation();
      await deleteSession(s.id);
    });
    item.addEventListener('click', () => loadSessionHistory(s.id));
    list.appendChild(item);
  });
}

/**
 * Load a past session's interactions into the chat pane.
 * @param {number} id
 */
async function loadSessionHistory(id) {
  try {
    const session = await apiGet(`/api/sessions/${id}`);
    const msgs    = document.getElementById('chat-messages');
    if (!msgs) return;
    msgs.innerHTML = '';
    state.messages = [];

    if (!session.interactions?.length) {
      msgs.innerHTML = '<p class="text-xs text-slate-600 italic text-center py-8">Empty session</p>';
      return;
    }

    session.interactions.forEach(ix => {
      appendMessage('user', ix.user_prompt, null);
      appendMessage('assistant', renderMarkdown(ix.response), {
        tokens_used: ix.tokens_used,
        latency_ms:  ix.latency_ms,
        provider:    session.provider_name,
        model:       session.model_name,
      });
    });
  } catch (err) {
    showToast('Could not load session: ' + err.message, 'error');
  }
}

/**
 * Delete a session and refresh the list.
 * @param {number} id
 */
async function deleteSession(id) {
  try {
    await apiDelete(`/api/sessions/${id}`);
    state.sessions = state.sessions.filter(s => s.id !== id);
    renderSessionList();
    showToast('Session deleted', 'success');
  } catch (err) {
    showToast('Could not delete session: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Append a message bubble to the chat pane.
 * @param {'user'|'assistant'} role
 * @param {string} content  Raw text (user) or sanitised HTML (assistant).
 * @param {object|null} meta  { tokens_used, latency_ms, provider, model }
 */
function appendMessage(role, content, meta) {
  const msgs  = document.getElementById('chat-messages');
  if (!msgs) return;

  const empty = document.getElementById('chat-empty-state');
  if (empty) empty.remove();

  const wrap = document.createElement('div');
  wrap.className = `chat-msg flex gap-3 ${role === 'user' ? 'flex-row-reverse' : ''}`;
  wrap.setAttribute('aria-label', `${role} message`);

  const avatar = document.createElement('div');
  avatar.className = role === 'user'
    ? 'w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5'
    : 'w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 flex-shrink-0 mt-0.5';
  avatar.textContent = role === 'user' ? 'U' : 'A';
  avatar.setAttribute('aria-hidden', 'true');

  const bubble = document.createElement('div');
  bubble.className = role === 'user'
    ? 'max-w-[78%] px-4 py-2.5 bg-indigo-900/50 border border-indigo-800/50 rounded-2xl rounded-tr-sm text-sm text-slate-100 whitespace-pre-wrap'
    : 'max-w-[78%] px-4 py-2.5 bg-slate-800 border border-slate-700/60 rounded-2xl rounded-tl-sm text-sm text-slate-100 prose-bubble';

  if (role === 'user') {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = content;
    if (typeof hljs !== 'undefined') {
      bubble.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
    }
  }

  const col = document.createElement('div');
  col.className = 'flex flex-col gap-1 min-w-0';
  col.appendChild(bubble);

  if (meta && role === 'assistant') {
    const metaEl = document.createElement('div');
    metaEl.className = 'text-[10px] text-slate-600 px-1 flex gap-3 flex-wrap';
    metaEl.setAttribute('aria-label', 'Response metadata');
    if (meta.input_tokens != null && meta.output_tokens != null) {
      metaEl.innerHTML += `<span>🪙 ${meta.input_tokens}↑ ${meta.output_tokens}↓</span>`;
    } else if (meta.tokens_used) {
      metaEl.innerHTML += `<span>🪙 ${meta.tokens_used} tokens</span>`;
    }
    const cost = formatCost(meta.model, meta.input_tokens, meta.output_tokens, meta.tokens_used);
    if (cost) metaEl.innerHTML += `<span>💰 ${cost}</span>`;
    if (meta.latency_ms)  metaEl.innerHTML += `<span>⚡ ${meta.latency_ms}ms</span>`;
    if (meta.provider)    metaEl.innerHTML += `<span>🔌 ${escapeHtml(meta.provider)}</span>`;
    if (meta.model)       metaEl.innerHTML += `<span>🤖 ${escapeHtml(meta.model)}</span>`;
    col.appendChild(metaEl);
  }

  wrap.appendChild(avatar);
  wrap.appendChild(col);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;

  state.messages.push({ role, content, meta });
}

/** Show / hide the send spinner. */
function setLoading(on) {
  const sendBtn = document.getElementById('send-btn');
  const spinner = document.getElementById('loading-spinner');
  const input   = document.getElementById('user-prompt');
  if (sendBtn) sendBtn.classList.toggle('hidden', on);
  if (spinner) spinner.classList.toggle('hidden', !on);
  if (input)   input.disabled = on;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT
// ═══════════════════════════════════════════════════════════════════════════

/** Read current UI values into state.params. */
function syncParamsFromUI() {
  state.params.temperature   = parseFloat(document.getElementById('temperature-slider')?.value ?? 0.7);
  state.params.top_p         = parseFloat(document.getElementById('top-p-slider')?.value ?? 0.9);
  state.params.max_tokens    = parseInt(document.getElementById('max-tokens-input')?.value ?? 1024, 10);
  state.params.provider_name = document.getElementById('provider-select')?.value || null;
  state.params.model         = document.getElementById('model-select')?.value || null;
  state.params.system_prompt = document.getElementById('system-prompt-textarea')?.value.trim() || null;
}

/**
 * Send the user's prompt, append both messages, and handle errors.
 * @returns {Promise<void>}
 */
async function sendPrompt() {
  if (!state.selectedPersona) {
    showToast('Select a persona first', 'error');
    return;
  }

  const promptEl = document.getElementById('user-prompt');
  const text     = promptEl?.value.trim() ?? '';
  if (!text) return;

  syncParamsFromUI();

  promptEl.value = '';
  if (promptEl.style) promptEl.style.height = 'auto';

  appendMessage('user', text, null);
  setLoading(true);

  try {
    const result = await apiPost('/api/chat', {
      persona_id:    state.selectedPersona.id,
      user_prompt:   text,
      temperature:   state.params.temperature,
      top_p:         state.params.top_p,
      max_tokens:    state.params.max_tokens,
      system_prompt: state.params.system_prompt,
      provider_name: state.params.provider_name,
      model:         state.params.model,
    });

    appendMessage('assistant', renderMarkdown(result.response), {
      tokens_used:   result.tokens_used,
      input_tokens:  result.input_tokens,
      output_tokens: result.output_tokens,
      latency_ms:    result.latency_ms,
      provider:      result.provider,
      model:         result.model,
    });

    fetchSessions(); // non-blocking refresh
  } catch (err) {
    appendMessage('assistant', `<span class="text-red-400">Error: ${escapeHtml(err.message)}</span>`, null);
    showToast(err.message, 'error');
  } finally {
    setLoading(false);
    promptEl?.focus();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPARE MODE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run two configurations in parallel and render the side-by-side results.
 * @returns {Promise<void>}
 */
async function sendCompare() {
  if (!state.selectedPersona) {
    showToast('Select a persona first', 'error');
    return;
  }

  const promptEl = document.getElementById('compare-prompt');
  const text     = promptEl?.value.trim() ?? '';
  if (!text) return;

  const spinner = document.getElementById('compare-spinner');
  const sendBtn = document.getElementById('compare-send-btn');
  const resA    = document.getElementById('compare-response-a');
  const resB    = document.getElementById('compare-response-b');
  const metaA   = document.getElementById('compare-meta-a');
  const metaB   = document.getElementById('compare-meta-b');

  if (spinner) spinner.classList.remove('hidden');
  if (sendBtn) sendBtn.disabled = true;
  if (resA)    resA.innerHTML = '<p class="text-slate-600 text-xs italic animate-pulse">Waiting for A…</p>';
  if (resB)    resB.innerHTML = '<p class="text-slate-600 text-xs italic animate-pulse">Waiting for B…</p>';
  if (metaA)   metaA.classList.add('hidden');
  if (metaB)   metaB.classList.add('hidden');

  // Read panel A params
  const aTemp     = parseFloat(document.getElementById('compare-a-temp')?.value ?? 0.7);
  const aTopP     = parseFloat(document.getElementById('compare-a-topp')?.value ?? 0.9);
  const aProvider = document.getElementById('compare-a-provider')?.value || null;
  const aModel    = document.getElementById('compare-a-model')?.value    || null;

  // Read panel B params
  const bTemp     = parseFloat(document.getElementById('compare-b-temp')?.value ?? 0.7);
  const bTopP     = parseFloat(document.getElementById('compare-b-topp')?.value ?? 0.9);
  const bProvider = document.getElementById('compare-b-provider')?.value || null;
  const bModel    = document.getElementById('compare-b-model')?.value    || null;

  try {
    const result = await apiPost('/api/compare', {
      user_prompt: text,
      config_a: { persona_id: state.selectedPersona.id, temperature: aTemp, top_p: aTopP, provider_name: aProvider, model: aModel },
      config_b: { persona_id: state.selectedPersona.id, temperature: bTemp, top_p: bTopP, provider_name: bProvider, model: bModel },
    });

    if (resA) { resA.innerHTML = renderMarkdown(result.response_a); resA.querySelectorAll?.('pre code').forEach(b => hljs?.highlightElement(b)); }
    if (resB) { resB.innerHTML = renderMarkdown(result.response_b); resB.querySelectorAll?.('pre code').forEach(b => hljs?.highlightElement(b)); }

    // Metadata + difference hints
    const lenA = result.response_a?.length ?? 0;
    const lenB = result.response_b?.length ?? 0;
    const lenHint = lenA !== lenB
      ? ` · ${lenA > lenB ? 'A longer' : 'B longer'} (${Math.abs(lenA - lenB)} chars)`
      : '';

    const costA = formatCost(result.model_a, result.input_tokens_a, result.output_tokens_a, result.tokens_a);
    const costB = formatCost(result.model_b, result.input_tokens_b, result.output_tokens_b, result.tokens_b);

    if (metaA) {
      let textA = result.provider_a || '—';
      if (result.model_a) textA += ` · ${result.model_a}`;
      textA += ` · ${result.tokens_a ?? '?'} tokens · ${result.latency_a}ms`;
      if (costA) textA += ` · ${costA}`;
      metaA.textContent = textA;
      metaA.classList.remove('hidden');
    }
    if (metaB) {
      let textB = result.provider_b || '—';
      if (result.model_b) textB += ` · ${result.model_b}`;
      textB += ` · ${result.tokens_b ?? '?'} tokens · ${result.latency_b}ms${lenHint}`;
      if (costB) textB += ` · ${costB}`;
      metaB.textContent = textB;
      metaB.classList.remove('hidden');
    }
  } catch (err) {
    const errHtml = `<p class="text-red-400 text-xs">${escapeHtml(err.message)}</p>`;
    if (resA) resA.innerHTML = errHtml;
    if (resB) resB.innerHTML = errHtml;
    showToast(err.message, 'error');
  } finally {
    if (spinner) spinner.classList.add('hidden');
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT VERSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save the current system-prompt textarea value as a new versioned prompt.
 * @returns {Promise<void>}
 */
async function savePromptVersion() {
  if (!state.selectedPersona) return;
  const text = document.getElementById('system-prompt-textarea')?.value.trim() ?? '';
  if (!text) { showToast('Prompt cannot be empty', 'error'); return; }

  try {
    const updated = await apiPut(`/api/personas/${state.selectedPersona.id}/prompt`, { prompt_text: text });
    const badge   = document.getElementById('prompt-version-badge');
    if (badge) { badge.textContent = `v${updated.version}`; badge.classList.remove('hidden'); }
    document.getElementById('save-prompt-version-btn')?.classList.add('hidden');
    state.selectedPersona.active_prompt = updated;
    showToast(`Prompt saved as version ${updated.version}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════════════════════════

function wire() {
  // ── Normal chat send ──────────────────────────────────────────────────────
  const userPrompt = document.getElementById('user-prompt');
  document.getElementById('send-btn')?.addEventListener('click', sendPrompt);
  userPrompt?.addEventListener('keydown', e => {
    // Enter (without Shift) OR Ctrl+Enter
    if (e.key === 'Enter' && (!e.shiftKey || e.ctrlKey)) {
      e.preventDefault();
      sendPrompt();
    }
  });
  userPrompt?.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 200) + 'px';
  });

  // ── Compare ───────────────────────────────────────────────────────────────
  document.getElementById('compare-send-btn')?.addEventListener('click', sendCompare);
  document.getElementById('compare-prompt')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCompare(); }
  });
  document.getElementById('compare-prompt')?.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 160) + 'px';
  });

  // Compare panel provider → populate model dropdown + update param visibility
  ['a', 'b'].forEach(panel => {
    document.getElementById(`compare-${panel}-provider`)?.addEventListener('change', function () {
      const pConfig = state.providers.find(p => p.provider_name === this.value);
      const models  = KNOWN_MODELS[this.value] ?? [];
      const sel     = document.getElementById(`compare-${panel}-model`);
      if (sel) {
        sel.innerHTML = models.length
          ? models.map(m => `<option value="${m}" ${m === pConfig?.default_model ? 'selected' : ''}>${m}</option>`).join('')
          : '<option value="">—</option>';
        updateComparePanelVisibility(panel, sel.value);
      }
    });

    document.getElementById(`compare-${panel}-model`)?.addEventListener('change', function () {
      updateComparePanelVisibility(panel, this.value);
    });
  });

  // Compare toggle → persist to localStorage
  document.getElementById('compare-toggle')?.addEventListener('change', function () {
    state.compareMode = this.checked;
    localStorage.setItem(LS_KEYS.COMPARE_MODE, this.checked ? '1' : '0');
  });

  // ── Right sidebar: provider → update model list ───────────────────────────
  document.getElementById('provider-select')?.addEventListener('change', function () {
    const pConfig = state.providers.find(p => p.provider_name === this.value);
    if (pConfig) {
      populateModelSelect(this.value, pConfig.default_model);
      state.params.provider_name = this.value;
      state.params.model         = pConfig.default_model;
      if (pConfig.is_enabled) updateProviderIndicator(pConfig.display_name, pConfig.default_model, true);
    }
  });

  // ── Right sidebar: model → update param visibility ────────────────────────
  document.getElementById('model-select')?.addEventListener('change', function () {
    state.params.model = this.value;
    updateSidebarParamVisibility(this.value);
  });

  // ── Temperature slider ────────────────────────────────────────────────────
  document.getElementById('temperature-slider')?.addEventListener('input', function () {
    const v = parseFloat(this.value);
    state.params.temperature = v;
    syncTempUI(v);
  });

  // ── Top-P slider ──────────────────────────────────────────────────────────
  document.getElementById('top-p-slider')?.addEventListener('input', function () {
    const v = parseFloat(this.value);
    state.params.top_p = v;
    syncTopPUI(v);
  });

  // ── Max tokens ────────────────────────────────────────────────────────────
  document.getElementById('max-tokens-input')?.addEventListener('change', function () {
    state.params.max_tokens = parseInt(this.value, 10) || 1024;
  });

  // ── Reset to persona defaults ─────────────────────────────────────────────
  document.getElementById('reset-params-btn')?.addEventListener('click', () => {
    if (!state.selectedPersona) return;
    loadPersonaDefaults(state.selectedPersona);
    showToast('Parameters reset to persona defaults');
  });

  // ── System prompt: reveal save button on edit ─────────────────────────────
  document.getElementById('system-prompt-textarea')?.addEventListener('input', () => {
    if (state.selectedPersona) {
      document.getElementById('save-prompt-version-btn')?.classList.remove('hidden');
    }
  });
  document.getElementById('save-prompt-version-btn')?.addEventListener('click', savePromptVersion);

  // ── Mobile params drawer ──────────────────────────────────────────────────
  (function wireDrawer() {
    const btn     = document.getElementById('params-drawer-btn');
    const sidebar = document.getElementById('params-sidebar');
    if (!btn || !sidebar) return;

    let overlay = null;

    function openDrawer() {
      sidebar.classList.add('drawer-open');
      btn.setAttribute('aria-expanded', 'true');
      overlay = document.createElement('div');
      overlay.className = 'drawer-overlay';
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('active'));
      overlay.addEventListener('click', closeDrawer, { once: true });
    }

    function closeDrawer() {
      sidebar.classList.remove('drawer-open');
      btn.setAttribute('aria-expanded', 'false');
      if (overlay) {
        overlay.classList.remove('active');
        overlay.addEventListener('transitionend', () => overlay?.remove(), { once: true });
        overlay = null;
      }
    }

    btn.addEventListener('click', () =>
      sidebar.classList.contains('drawer-open') ? closeDrawer() : openDrawer()
    );

    // Close drawer on Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && sidebar.classList.contains('drawer-open')) closeDrawer();
    });
  })();

  // ── Preset examples dropdown ─────────────────────────────────────────────
  const presetSel = document.getElementById('preset-select');
  if (presetSel) {
    PRESETS.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = p.label;
      presetSel.appendChild(opt);
    });
    presetSel.addEventListener('change', function () {
      if (this.value === '') return;
      const preset = PRESETS[parseInt(this.value, 10)];
      if (!preset) return;
      const promptEl = document.getElementById('user-prompt');
      if (promptEl) {
        promptEl.value = preset.prompt;
        promptEl.dispatchEvent(new Event('input')); // trigger auto-resize
        promptEl.focus();
      }
      this.value = ''; // reset to placeholder after loading
    });
  }

  // ── Demo comparison button ────────────────────────────────────────────────
  document.getElementById('demo-compare-btn')?.addEventListener('click', () => {
    // Switch to compare mode
    const toggle = document.getElementById('compare-toggle');
    if (toggle && !toggle.checked) {
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
    }

    // Set Panel A: precise (temp 0.2, top-p 0.8)
    const aTempEl  = document.getElementById('compare-a-temp');
    const aTopPEl  = document.getElementById('compare-a-topp');
    const aTempVal = document.getElementById('compare-a-temp-val');
    const aTopPVal = document.getElementById('compare-a-topp-val');
    if (aTempEl) { aTempEl.value = '0.2';  if (aTempVal) aTempVal.textContent = '0.20'; if (typeof setSliderFill === 'function') setSliderFill(aTempEl); }
    if (aTopPEl) { aTopPEl.value = '0.8';  if (aTopPVal) aTopPVal.textContent = '0.80'; if (typeof setSliderFill === 'function') setSliderFill(aTopPEl); }

    // Set Panel B: creative (temp 1.5, top-p 0.95)
    const bTempEl  = document.getElementById('compare-b-temp');
    const bTopPEl  = document.getElementById('compare-b-topp');
    const bTempVal = document.getElementById('compare-b-temp-val');
    const bTopPVal = document.getElementById('compare-b-topp-val');
    if (bTempEl) { bTempEl.value = '1.5';  if (bTempVal) bTempVal.textContent = '1.50'; if (typeof setSliderFill === 'function') setSliderFill(bTempEl); }
    if (bTopPEl) { bTopPEl.value = '0.95'; if (bTopPVal) bTopPVal.textContent = '0.95'; if (typeof setSliderFill === 'function') setSliderFill(bTopPEl); }

    // Pre-fill compare prompt if empty
    const comparePromptEl = document.getElementById('compare-prompt');
    if (comparePromptEl && !comparePromptEl.value.trim()) {
      comparePromptEl.value = 'Write a short story opening sentence about a detective discovering an unusual clue at a rainy crime scene.';
      comparePromptEl.dispatchEvent(new Event('input'));
    }

    showToast('Demo loaded — Panel A: precise (0.2), Panel B: creative (1.5). Hit Compare!', 'info', 4500);
  });

  // ── Settings modal buttons ────────────────────────────────────────────────
  document.getElementById('settings-btn')?.addEventListener('click', () => {
    document.getElementById('settings-modal')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  });

  // OpenAI card
  document.getElementById('openai-save-btn')?.addEventListener('click', async () => {
    const key   = document.getElementById('openai-key-input')?.value.trim() ?? '';
    const model = document.getElementById('openai-model-select')?.value ?? '';
    if (!key) { showToast('Enter an API key', 'error'); return; }
    try {
      await saveApiKey('openai', key, model);
      const inp = document.getElementById('openai-key-input');
      if (inp) inp.value = '';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('openai-model-select')?.addEventListener('change', async function () {
    const pConfig = state.providers.find(p => p.provider_name === 'openai');
    if (!pConfig?.is_enabled) return;
    await updateProviderModel('openai', this.value);
  });

  document.getElementById('openai-test-btn')?.addEventListener('click', () => {
    testConnection('openai', 'openai-test-result');
  });

  document.getElementById('openai-default-btn')?.addEventListener('click', () => {
    setDefaultProvider('openai');
  });

  document.getElementById('openai-remove-btn')?.addEventListener('click', () => {
    removeApiKey('openai');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bootstrap the application.
 * Order matters: providers first (needed to know if setup wizard shows),
 * then personas (auto-selects first), then sessions.
 */
async function init() {
  wire();

  // Restore compare-mode toggle from localStorage
  const savedCompare = localStorage.getItem(LS_KEYS.COMPARE_MODE) === '1';
  if (savedCompare) {
    const toggle = document.getElementById('compare-toggle');
    if (toggle) {
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
    }
  }

  // Fetch in parallel where possible; providers must finish before we know
  // which setup-wizard state to show, but personas and sessions are independent.
  await fetchProviders();
  await Promise.all([fetchPersonas(), fetchSessions()]);
}

document.addEventListener('DOMContentLoaded', init);
