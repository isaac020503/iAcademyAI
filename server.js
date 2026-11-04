require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { AIService } = require('./ai');
const { streamToClient } = require('./ai/sse');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function ensureStore(filePath, initialValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(initialValue, null, 2));
  }
}

ensureStore(USERS_PATH, []);
ensureStore(SESSIONS_PATH, []);

function readStore(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return [];
  }
}

function writeStore(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  }
  // Legacy unsalted SHA-256 accounts: still accepted once, then upgraded on login.
  return crypto.createHash('sha256').update(password).digest('hex') === stored;
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function findUserByEmail(email) {
  const users = readStore(USERS_PATH);
  return users.find(user => user.email.toLowerCase() === String(email || '').toLowerCase());
}

function findUserById(userId) {
  const users = readStore(USERS_PATH);
  return users.find(user => user.id === userId);
}

function serializeUser(user) {
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
}

function getSessionUser(req) {
  const header = req.headers.authorization || req.headers['x-auth-token'];
  if (!header) return null;

  const token = String(header).startsWith('Bearer ') ? String(header).slice(7) : String(header);
  const sessions = readStore(SESSIONS_PATH);
  const session = sessions.find(entry => entry.token === token);
  if (!session) return null;

  const user = findUserById(session.userId);
  if (!user) return null;

  return serializeUser(user);
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  req.user = user;
  next();
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const ai = new AIService({ dataDir: DATA_DIR });

const competencyData = [
  {
    id: 'sd-js-fundamentals',
    name: 'JavaScript Fundamentals',
    domain: 'Software Development',
    status: 'Learning',
    progress: 68,
    mastery: 72,
    evidence: ['Variables and functions', 'DOM manipulation', 'Async patterns'],
    nextAction: 'Complete the DOM lab and build the mini project.'
  },
  {
    id: 'ai-py-data',
    name: 'Python for AI',
    domain: 'Artificial Intelligence',
    status: 'Practicing',
    progress: 54,
    mastery: 63,
    evidence: ['Pandas workflow', 'NumPy operations', 'Data cleaning'],
    nextAction: 'Practice a supervised learning notebook and evaluate metrics.'
  },
  {
    id: 'cyber-linux',
    name: 'Linux for Security Operations',
    domain: 'Cybersecurity',
    status: 'Assessment Pending',
    progress: 80,
    mastery: 77,
    evidence: ['Shell scripting', 'Permissions', 'Log analysis'],
    nextAction: 'Submit the incident response simulation.'
  },
  {
    id: 'cloud-devops',
    name: 'CI/CD Pipelines',
    domain: 'Cloud & Infrastructure',
    status: 'Competent',
    progress: 88,
    mastery: 86,
    evidence: ['GitHub Actions', 'Docker', 'Deployment workflow'],
    nextAction: 'Automate a production-ready deployment pipeline.'
  }
];

const skillDomains = [
  {
    name: 'Software Development',
    learners: 12800,
    pathways: 14,
    trend: '+18% this month',
    focus: 'Web, backend, APIs, and engineering fundamentals.'
  },
  {
    name: 'Artificial Intelligence',
    learners: 9600,
    pathways: 11,
    trend: '+24% this month',
    focus: 'AI fundamentals, ML, and agent workflows.'
  },
  {
    name: 'Cybersecurity',
    learners: 7300,
    pathways: 9,
    trend: '+12% this month',
    focus: 'Security operations, compliance and defensive skills.'
  },
  {
    name: 'Cloud & Infrastructure',
    learners: 8800,
    pathways: 10,
    trend: '+15% this month',
    focus: 'Automation, containers, and cloud platforms.'
  }
];

const pathways = [
  {
    id: 'web-fullstack-path',
    title: 'Full-Stack Web Developer',
    domain: 'Software Development',
    level: 'Foundational to Intermediate',
    duration: '8 weeks',
    completion: 74,
    outcomes: ['Build APIs', 'Ship UI', 'Deploy apps']
  },
  {
    id: 'ai-agent-path',
    title: 'AI Application Builder',
    domain: 'Artificial Intelligence',
    level: 'Intermediate',
    duration: '6 weeks',
    completion: 61,
    outcomes: ['Evaluate models', 'Build agents', 'Integrate tooling']
  },
  {
    id: 'security-ops-path',
    title: 'Cybersecurity Analyst',
    domain: 'Cybersecurity',
    level: 'Beginner to Applied',
    duration: '10 weeks',
    completion: 68,
    outcomes: ['Threat analysis', 'Log review', 'Incident response']
  }
];

const projects = [
  {
    title: 'Skill Passport',
    status: 'In progress',
    owner: 'Isaac',
    completion: 76,
    summary: 'Portfolio of verified skill artifacts and challenge results.'
  },
  {
    title: 'AI Tutor Coach',
    status: 'In review',
    owner: 'Learning Lab',
    completion: 94,
    summary: 'Coach that explains steps, nudges learners, and validates outputs.'
  },
  {
    title: 'Threat Response Playbook',
    status: 'Draft',
    owner: 'Cyber Lab',
    completion: 52,
    summary: 'Simulated SOC workflow with triage, containment, and reporting.'
  }
];

const learningMap = [
  {
    title: 'Frontend Foundations',
    track: 'Software Development',
    score: 82,
    description: 'HTML, CSS, JavaScript, accessibility, and debugging workflows.'
  },
  {
    title: 'AI Workflow Design',
    track: 'Artificial Intelligence',
    score: 74,
    description: 'Prompting, evaluation, retrieval, and using models in practical tools.'
  },
  {
    title: 'Secure Operations',
    track: 'Cybersecurity',
    score: 88,
    description: 'Threat modeling, log analysis, incident triage, and hardening.'
  },
  {
    title: 'Cloud Automation',
    track: 'Cloud & Infrastructure',
    score: 79,
    description: 'Containers, CI/CD, configuration as code, and deployment readiness.'
  }
];

const recommendations = [
  {
    id: 'portfolio-track',
    title: 'Build a portfolio sprint',
    category: 'Career readiness',
    reason: 'Your current evidence is strong, but a visible portfolio project will improve hiring readiness.',
    action: 'Create a capstone that demonstrates API design, deployment, and user testing.'
  },
  {
    id: 'ai-eval-track',
    title: 'Evaluate AI outputs with evidence',
    category: 'AI literacy',
    reason: 'The best AI systems are evaluated against measurable goals, not prompt style alone.',
    action: 'Measure accuracy, latency, and safety across several prompts and tasks.'
  },
  {
    id: 'security-harden',
    title: 'Harden the learning stack',
    category: 'Security',
    reason: 'Security skills improve with hands-on threat analysis and hardening exercises.',
    action: 'Run an incident replay and produce a remediation checklist.'
  }
];

const challengeCatalog = [
  {
    id: 'js-sum-odds',
    title: 'Code Challenge: Sum Odd Numbers',
    domain: 'Software Development',
    difficulty: 'Beginner',
    description: 'Write a function that returns the sum of all odd numbers in an array.',
    starter: `function sumOdds(nums) {
  // write your implementation here
}`,
    tests: [
      { input: [1, 2, 3, 4, 5], expected: 9 },
      { input: [10, 7, 2, 9, 8], expected: 16 },
      { input: [0, 0, 0], expected: 0 }
    ],
    rubric: ['Handles empty arrays', 'Uses correct odd filtering logic', 'Returns numeric total']
  },
  {
    id: 'py-list-normalizer',
    title: 'Python Data Lab: Normalize Values',
    domain: 'Artificial Intelligence',
    difficulty: 'Intermediate',
    description: 'Create a function that normalizes a list of numeric values into a 0 to 1 range.',
    starter: `def normalize(values):
    # write your implementation here
    return values`,
    tests: [
      { input: [10, 20, 30], expected: [0, 0.5, 1] },
      { input: [5, 5, 5], expected: [0, 0, 0] }
    ],
    rubric: ['Preserves order', 'Avoids divide-by-zero issues', 'Returns clean numeric output']
  }
];

function getOverview() {
  return {
    summary: {
      activeLearners: 24500,
      competencies: competencyData.length,
      labsCompleted: 1462,
      masteryRate: 82
    },
    domains: skillDomains,
    pathways,
    projects,
    competencies: competencyData,
    learningMap,
    recommendations
  };
}

function getProfile(user) {
  const profileUser = user || {
    name: 'Isaac',
    role: 'Career switcher / aspiring full-stack engineer',
    focus: 'Frontend, AI tooling, and cloud-native learning',
    streak: 21,
    weeklyMinutes: 310,
    nextMilestone: 'Portfolio sprint and project review',
    challengeHistory: []
  };

  const challengeHistory = Array.isArray(profileUser.challengeHistory) ? profileUser.challengeHistory.slice(0, 4) : [];

  return {
    learner: {
      name: profileUser.name || 'Learner',
      role: profileUser.role || 'Technology learner',
      focus: profileUser.focus || 'Frontend, AI tooling, and cloud-native learning',
      streak: profileUser.streak || 21,
      weeklyMinutes: profileUser.weeklyMinutes || 310,
      nextMilestone: profileUser.nextMilestone || 'Portfolio sprint and project review'
    },
    skillSnapshot: [
      { label: 'JavaScript', value: profileUser.skillScores?.javascript ?? 82 },
      { label: 'Python', value: profileUser.skillScores?.python ?? 74 },
      { label: 'AI tooling', value: profileUser.skillScores?.ai ?? 79 },
      { label: 'Security', value: profileUser.skillScores?.security ?? 68 },
      { label: 'Cloud', value: profileUser.skillScores?.cloud ?? 71 }
    ],
    recentChallenges: challengeHistory.map(item => ({
      id: item.challengeId,
      status: item.passed ? 'Passed' : 'Needs work',
      summary: item.feedback,
      when: item.at ? new Date(item.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Today'
    }))
  };
}

function updateUserProfile(userId, updates) {
  const users = readStore(USERS_PATH);
  const index = users.findIndex(user => user.id === userId);
  if (index === -1) return null;

  const cleanedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  );

  const nextUser = {
    ...users[index],
    ...cleanedUpdates,
    skillScores: {
      ...users[index].skillScores,
      ...(cleanedUpdates.skillScores || {})
    }
  };

  users[index] = nextUser;
  writeStore(USERS_PATH, users);
  return nextUser;
}

function recordChallengeHistory(userId, challengeId, result) {
  if (!userId || !challengeId) return null;

  const users = readStore(USERS_PATH);
  const index = users.findIndex(user => user.id === userId);
  if (index === -1) return null;

  const history = Array.isArray(users[index].challengeHistory) ? users[index].challengeHistory : [];
  const nextHistory = [
    {
      challengeId,
      passed: Boolean(result?.passed),
      feedback: result?.feedback || 'Challenge submitted',
      at: new Date().toISOString()
    },
    ...history
  ].slice(0, 8);

  const nextUser = {
    ...users[index],
    challengeHistory: nextHistory,
    streak: result?.passed ? Math.max(users[index].streak || 1, (users[index].streak || 1) + 1) : users[index].streak || 1,
    weeklyMinutes: Math.max(users[index].weeklyMinutes || 120, (users[index].weeklyMinutes || 120) + 25)
  };

  users[index] = nextUser;
  writeStore(USERS_PATH, users);
  return nextUser;
}

app.get('/api/overview', (req, res) => {
  res.json(getOverview());
});

app.get('/api/profile', (req, res) => {
  const user = getSessionUser(req) || null;
  res.json(getProfile(user));
});

app.put('/api/profile', requireAuth, (req, res) => {
  const { name, role, focus, nextMilestone, streak, weeklyMinutes, skillScores } = req.body || {};
  const updatedUser = updateUserProfile(req.user.id, {
    name: name ? String(name).trim() : undefined,
    role: role ? String(role).trim() : undefined,
    focus: focus ? String(focus).trim() : undefined,
    nextMilestone: nextMilestone ? String(nextMilestone).trim() : undefined,
    streak: typeof streak === 'number' ? streak : undefined,
    weeklyMinutes: typeof weeklyMinutes === 'number' ? weeklyMinutes : undefined,
    skillScores: skillScores && typeof skillScores === 'object' ? skillScores : undefined
  });

  if (!updatedUser) {
    return res.status(404).json({ error: 'Profile not found.' });
  }

  res.json({ user: serializeUser(updatedUser) });
});

app.get('/api/recommendations', (req, res) => {
  res.json(recommendations);
});

app.get('/api/challenges', (req, res) => {
  res.json(challengeCatalog);
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  const users = readStore(USERS_PATH);
  if (users.some(user => user.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: 'A user already exists with that email.' });
  }

  const newUser = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    password: hashPassword(String(password)),
    role: 'Technology learner',
    focus: 'Frontend, AI tooling, and cloud-native learning',
    streak: 1,
    weeklyMinutes: 120,
    nextMilestone: 'Complete your first portfolio project',
    challengeHistory: [],
    skillScores: {
      javascript: 60,
      python: 55,
      ai: 62,
      security: 50,
      cloud: 58
    }
  };

  users.push(newUser);
  writeStore(USERS_PATH, users);

  const token = createToken();
  const sessions = readStore(SESSIONS_PATH);
  sessions.push({ userId: newUser.id, token });
  writeStore(SESSIONS_PATH, sessions);

  res.status(201).json({ token, user: serializeUser(newUser) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = findUserByEmail(email);

  if (!user || !verifyPassword(String(password || ''), user.password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (!String(user.password).startsWith('scrypt$')) {
    updateUserProfile(user.id, { password: hashPassword(String(password)) });
  }

  const token = createToken();
  const sessions = readStore(SESSIONS_PATH);
  sessions.push({ userId: user.id, token });
  writeStore(SESSIONS_PATH, sessions);

  res.json({ token, user: serializeUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = (req.headers.authorization || req.headers['x-auth-token'] || '').toString();
  const sessions = readStore(SESSIONS_PATH);
  const cleaned = sessions.filter(entry => entry.token !== token.replace(/^Bearer\s+/i, ''));
  writeStore(SESSIONS_PATH, cleaned);
  res.status(200).json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ---------- AI (OpenAI) ----------
app.get('/api/ai/status', requireAuth, (req, res) => {
  res.json(ai.status(req.user.id));
});

app.post('/api/ai/chat', requireAuth, (req, res) => {
  streamToClient(res, signal => ai.streamChat(req.user.id, req.body || {}, signal));
});

app.post('/api/ai/lecture', requireAuth, (req, res) => {
  streamToClient(res, signal => ai.streamLecture(req.user.id, req.body || {}, signal));
});

// Legacy single-shot coach endpoint, now backed by the real model (no canned answers).
app.post('/api/coach', requireAuth, async (req, res) => {
  const prompt = String((req.body || {}).prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Ask a question first.' });

  try {
    const response = await ai.complete(req.user.id, { messages: [{ role: 'user', content: prompt }], mode: 'tutor' });
    res.json({ response });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message || 'The AI request failed.' });
  }
});

// Challenges run in the learner's browser (Web Worker). The server never executes
// submitted code; it only records the outcome the browser reports.
app.post('/api/challenges/submit', (req, res) => {
  const { challengeId, passed, feedback } = req.body || {};
  const challenge = challengeCatalog.find(item => item.id === challengeId);
  if (!challenge) return res.status(404).json({ error: 'Challenge not found.' });

  const result = {
    passed: Boolean(passed),
    feedback: String(feedback || '').slice(0, 300) || (passed ? 'Challenge passed.' : 'Challenge not passed.')
  };

  const user = getSessionUser(req);
  if (user) {
    recordChallengeHistory(user.id, challengeId, result);
  }

  res.json({ challengeId, ...result });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`iAcademyAI is running on http://localhost:${PORT}`);
});
