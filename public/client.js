const navButtons = [...document.querySelectorAll('.nav-item')];
const panels = [...document.querySelectorAll('.panel')];
const authPanel = document.getElementById('auth-panel');
const sessionStatus = document.getElementById('session-status');
const state = {
  token: localStorage.getItem('iacademy-token') || ''
};

function setSessionStatus(message, isError = false) {
  sessionStatus.textContent = message;
  sessionStatus.classList.toggle('hidden', !message);
  sessionStatus.style.background = isError ? 'rgba(248, 113, 113, 0.12)' : 'rgba(52, 211, 153, 0.12)';
  sessionStatus.style.borderColor = isError ? 'rgba(248, 113, 113, 0.28)' : 'rgba(52, 211, 153, 0.28)';
  sessionStatus.style.color = isError ? '#fee2e2' : '#dcfce7';
}

async function apiRequest(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...headers }
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || 'Request failed');
  }

  return response.json();
}

navButtons.forEach(button => {
  button.addEventListener('click', () => {
    navButtons.forEach(btn => btn.classList.toggle('active', btn === button));
    panels.forEach(panel => {
      panel.classList.toggle('active-panel', panel.id === button.dataset.target);
    });
  });
});

async function fetchOverview() {
  return apiRequest('/api/overview');
}

async function fetchProfile() {
  return apiRequest('/api/profile');
}

function renderSummary(data) {
  const summaryGrid = document.getElementById('summary-grid');
  const metrics = [
    { label: 'Active learners', value: data.summary.activeLearners.toLocaleString() },
    { label: 'Competencies', value: data.summary.competencies },
    { label: 'Labs completed', value: data.summary.labsCompleted.toLocaleString() },
    { label: 'Mastery rate', value: `${data.summary.masteryRate}%` }
  ];

  summaryGrid.innerHTML = metrics
    .map(item => `
      <div class="metric-card">
        <h3>${item.label}</h3>
        <strong>${item.value}</strong>
      </div>
    `)
    .join('');
}

function renderProfile(data) {
  const summaryGrid = document.getElementById('summary-grid');
  const profileCard = document.createElement('div');
  profileCard.className = 'metric-card';

  const recentChallenges = (data.recentChallenges || []).map(item => `
    <li class="priority-item">
      <strong>${item.status}</strong> · ${item.id}<br />
      <span class="muted">${item.summary}</span>
    </li>
  `).join('') || '<li class="priority-item">No evidence yet — complete a challenge to start your learning trail.</li>';

  profileCard.innerHTML = `
    <h3>${data.learner.name}</h3>
    <strong>${data.learner.streak} day streak</strong>
    <p class="muted">${data.learner.role}</p>
    <p class="muted">Next milestone: ${data.learner.nextMilestone}</p>
    <div class="profile-evidence">
      <h4>Recent evidence</h4>
      <ul class="priority-list">${recentChallenges}</ul>
    </div>
  `;
  summaryGrid.appendChild(profileCard);
  const primaryButton = document.querySelector('.topbar .primary-btn');
  if (primaryButton) {
    primaryButton.textContent = 'Continue learning';
  }
}

function updateAuthVisibility() {
  const loggedIn = Boolean(state.token);
  authPanel.classList.toggle('hidden', loggedIn);
  const session = document.getElementById('session-status');
  if (loggedIn) {
    sessionStatus.textContent = 'Signed in and ready to learn.';
    sessionStatus.classList.remove('hidden');
  } else {
    sessionStatus.classList.add('hidden');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value.trim();

  try {
    const payload = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });

    state.token = payload.token;
    localStorage.setItem('iacademy-token', payload.token);
    setSessionStatus(`Welcome, ${payload.user.name}!`);
    updateAuthVisibility();
    loadDashboard();
  } catch (error) {
    setSessionStatus(error.message, true);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();

  try {
    const payload = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    state.token = payload.token;
    localStorage.setItem('iacademy-token', payload.token);
    setSessionStatus(`Signed in as ${payload.user.name}.`);
    updateAuthVisibility();
    loadDashboard();
  } catch (error) {
    setSessionStatus(error.message, true);
  }
}

function handleLogout() {
  localStorage.removeItem('iacademy-token');
  state.token = '';
  setSessionStatus('Signed out.');
  updateAuthVisibility();
  window.location.reload();
}

function renderDomains(data) {
  const domainList = document.getElementById('domain-list');
  const priorities = document.getElementById('priority-list');

  const mapItems = (data.learningMap || data.domains || []).map(item => `
    <div class="domain-item">
      <div class="domain-head">
        <h4>${item.title || item.name}</h4>
        <span class="muted">${item.track || item.trend || 'Live'}</span>
      </div>
      <p class="muted">${item.description || item.focus}</p>
      <div class="progress-bar"><span style="width: ${Math.min(100, item.score || item.pathways * 10 || 70)}%"></span></div>
    </div>
  `).join('');

  domainList.innerHTML = mapItems || data.domains
    .map(domain => `
      <div class="domain-item">
        <div class="domain-head">
          <h4>${domain.name}</h4>
          <span class="muted">${domain.trend}</span>
        </div>
        <p class="muted">${domain.focus}</p>
        <div class="progress-bar"><span style="width: ${Math.min(100, (domain.pathways / 15) * 100)}%"></span></div>
      </div>
    `)
    .join('');

  const recommendationItems = (data.recommendations || [
    'Review learner outcomes for AI pathway completion using project evidence.',
    'Prioritize a portfolio-based challenge for JavaScript and Python novices.',
    'Expand the cybersecurity lab with simulated incident response exercises.'
  ]).map(item => typeof item === 'string' ? `<li class="priority-item">${item}</li>` : `<li class="priority-item"><strong>${item.title}</strong><br /><span class="muted">${item.reason}</span></li>`).join('');

  priorities.innerHTML = recommendationItems;
}

function renderPathways(data) {
  const container = document.getElementById('pathway-list');
  container.innerHTML = data.pathways.map(pathway => `
    <div class="pathway-card">
      <div class="pathway-head">
        <h4>${pathway.title}</h4>
        <span class="chip">${pathway.domain}</span>
      </div>
      <p class="muted">${pathway.level}</p>
      <div class="progress-bar"><span style="width: ${pathway.completion}%"></span></div>
      <div class="pathway-meta">
        <span>${pathway.duration}</span>
        <span>${pathway.completion}% complete</span>
      </div>
      <ul class="priority-list">
        ${pathway.outcomes.map(outcome => `<li class="priority-item">${outcome}</li>`).join('')}
      </ul>
    </div>
  `).join('');
}

function renderCompetencies(data) {
  const container = document.getElementById('competency-list');
  container.innerHTML = data.competencies.map(item => `
    <div class="competency-row">
      <div class="competency-details">
        <h4>${item.name}</h4>
        <p class="muted">${item.domain}</p>
        <div class="progress-bar"><span style="width: ${item.progress}%"></span></div>
        <p class="muted">Evidence: ${item.evidence.join(', ')}</p>
      </div>
      <div>
        <span class="competency-status">${item.status}</span>
        <p class="muted">Next: ${item.nextAction}</p>
      </div>
    </div>
  `).join('');
}

function renderProjects(data) {
  const container = document.getElementById('project-list');
  container.innerHTML = data.projects.map(project => `
    <div class="project-card">
      <h4>${project.title}</h4>
      <p class="muted">${project.summary}</p>
      <div class="progress-bar"><span style="width: ${project.completion}%"></span></div>
      <div class="project-meta">
        <span>${project.status}</span>
        <span>${project.owner}</span>
      </div>
    </div>
  `).join('');
}

function renderChallenges() {
  fetch('/api/challenges')
    .then(response => response.json())
    .then(challenges => {
      const container = document.getElementById('lab-list');
      container.innerHTML = challenges.map(challenge => `
        <div class="challenge-card">
          <div class="challenge-header">
            <h4>${challenge.title}</h4>
            <span class="chip">${challenge.difficulty}</span>
          </div>
          <p class="muted">${challenge.description}</p>
          <div class="challenge-meta">
            <span>${challenge.domain}</span>
            <span>${challenge.rubric.length} rubric checks</span>
          </div>
          <textarea data-challenge-id="${challenge.id}">${challenge.starter}</textarea>
          <div class="challenge-actions">
            <button class="primary-btn" data-submit="${challenge.id}">Run challenge</button>
            <button class="secondary-btn" type="button" data-reset="${challenge.id}">Reset</button>
          </div>
          <div class="challenge-feedback" data-feedback="${challenge.id}"></div>
        </div>
      `).join('');

      document.querySelectorAll('[data-submit]').forEach(button => {
        button.addEventListener('click', async () => {
          const challengeId = button.dataset.submit;
          const textarea = document.querySelector(`textarea[data-challenge-id="${challengeId}"]`);
          const payload = await apiRequest('/api/challenges/submit', {
            method: 'POST',
            body: JSON.stringify({ challengeId, code: textarea.value })
          });
          const feedback = document.querySelector(`[data-feedback="${challengeId}"]`);
          feedback.textContent = payload.feedback;
          feedback.style.color = payload.passed ? '#34d399' : '#fbbf24';

          if (state.token) {
            loadDashboard();
          }
        });
      });

      document.querySelectorAll('[data-reset]').forEach(button => {
        button.addEventListener('click', () => {
          const challengeId = button.dataset.reset;
          const challenge = challenges.find(item => item.id === challengeId);
          const textarea = document.querySelector(`textarea[data-challenge-id="${challengeId}"]`);
          textarea.value = challenge.starter;
          const feedback = document.querySelector(`[data-feedback="${challengeId}"]`);
          feedback.textContent = '';
        });
      });
    });
}

document.getElementById('coach-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('coach-input');
  const output = document.getElementById('coach-output');

  output.textContent = 'Thinking through a practical learning plan...';
  output.classList.remove('empty-state');

  const payload = await apiRequest('/api/coach', {
    method: 'POST',
    body: JSON.stringify({ prompt: input.value })
  });

  output.innerHTML = `
    <strong>Coach guidance</strong><br />
    ${payload.response}<br /><br />
    <strong>Hint ladder</strong><br />
    ${payload.hints.map(hint => `• ${hint}<br />`).join('')}
  `;
});

function attachAuthForms() {
  document.getElementById('register-form').addEventListener('submit', handleRegister);
  document.getElementById('login-form').addEventListener('submit', handleLogin);

  const topButton = document.querySelector('.topbar .primary-btn');
  if (topButton) {
    topButton.addEventListener('click', () => {
      const authMode = !state.token;
      if (authMode) {
        document.getElementById('auth-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        document.getElementById('labs').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  const logoutButton = document.createElement('button');
  logoutButton.type = 'button';
  logoutButton.className = 'secondary-btn';
  logoutButton.textContent = 'Sign out';
  logoutButton.addEventListener('click', handleLogout);

  const topbar = document.querySelector('.topbar');
  if (topbar) {
    topbar.appendChild(logoutButton);
    logoutButton.classList.toggle('hidden', !state.token);
  }
}

async function loadDashboard() {
  try {
    const overview = await fetchOverview();
    renderSummary(overview);
    renderDomains(overview);
    renderPathways(overview);
    renderCompetencies(overview);
    renderProjects(overview);

    const profile = await fetchProfile();
    renderProfile(profile);
    updateAuthVisibility();
  } catch (error) {
    setSessionStatus(error.message, true);
  }
}

attachAuthForms();
updateAuthVisibility();
if (state.token) {
  loadDashboard();
} else {
  fetchOverview().then(data => {
    renderSummary(data);
    renderDomains(data);
    renderPathways(data);
    renderCompetencies(data);
    renderProjects(data);
  });
}

renderChallenges();
