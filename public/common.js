// Shared helpers for all three pages.

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.pin) headers['x-pin'] = opts.pin;
  let res;
  try {
    res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin'
    });
  } catch (e) {
    return { ok: false, status: 0, data: { error: 'No connection. Check your network and try again.' } };
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* non-JSON response */ }
  return { ok: res.ok, status: res.status, data };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function $(sel) { return document.querySelector(sel); }

function show(id) {
  document.querySelectorAll('[data-screen]').forEach(el => el.classList.toggle('hidden', el.id !== id));
  window.scrollTo(0, 0);
}

const CRITERIA = [
  {
    key: 'value', label: 'value',
    desc: 'Genuinely useful and impactful as a real tool for stc or its customers.',
    anchors: ['Little real value', 'Marginal usefulness', 'Useful but limited', 'Strong, useful tool', 'High impact, clearly worth taking forward'],
    questions: ['Could this make a real difference if adopted?', 'Who benefits, and how much?', 'Is it worth investing in further?']
  },
  {
    key: 'feasibility', label: 'feasibility',
    desc: 'Built and robust enough to credibly become a real tool.',
    anchors: ['Not a credible path to a real tool', 'Brittle, significant rework', 'Works but needs real hardening', 'Mostly robust, minor work', 'Solid and close to ready for real use'],
    questions: ['How close is it to something usable?', 'What would it take to make it real?', 'Is it robust enough to trust?']
  },
  {
    key: 'risk', label: 'risk',
    desc: 'Remaining commercial and technical risk of taking it to production. 5 means low risk, well controlled.',
    anchors: ['High risk (financial, legal, reputational or accuracy), not mitigated', 'Notable risk, partial mitigation', 'Manageable risk with review and safeguards', 'Low risk with simple safeguards', 'Low risk, easily controlled in production'],
    questions: ['What could go wrong in real use?', 'Is it controllable with safeguards?', 'Is the remaining risk acceptable to take forward?']
  },
  {
    key: 'originality', label: 'originality',
    desc: 'Does it stand out compared to the other finalists?',
    anchors: ['Generic or derivative', 'Conventional', 'Reasonable but familiar', 'Fresh approach with notable elements', 'Genuinely original, surprising or distinctive'],
    questions: ['Did this stand out compared to the others?', 'Did they bring a perspective the others did not?', 'Is the approach memorable?']
  },
  {
    key: 'presentation', label: 'presentation',
    desc: 'Did they communicate their work clearly and credibly?',
    anchors: ['Confusing or poor communication', 'Communication issues that obscured the work', 'Adequate communication', 'Strong communication with minor gaps', 'Clear, confident, easy to understand and remember'],
    questions: ['Could a non-technical person understand what was built?', 'Did they answer questions confidently?', 'Did they show the work, not just describe it?']
  }
];
