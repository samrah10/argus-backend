import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const MOCK_MODE = String(process.env.MOCK_MODE || '').toLowerCase() === 'true';

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(OPENAI_API_KEY),
    mockMode: MOCK_MODE,
    model: MODEL,
    appName: 'Argus'
  });
});

app.post('/api/analyze', async (req, res) => {
  try {
    const { imageDataUrl, previousAnalysis } = req.body ?? {};

    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing imageDataUrl.' });
    }

    if (MOCK_MODE || !OPENAI_API_KEY) {
      return res.json({ ok: true, analysis: makeMockResponse(previousAnalysis) });
    }

    const analysis = await analyzeFrame(imageDataUrl, previousAnalysis);
    return res.json({ ok: true, analysis });
  } catch (error) {
    console.error('Analyze error:', error);
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Analysis failed.'
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Argus server running on http://localhost:${PORT}`);
  if (!OPENAI_API_KEY) {
    console.log('OPENAI_API_KEY is not set. The app will use mock responses unless you add a key.');
  }
});

function makeMockResponse(previousAnalysis) {
  const samples = [
    {
      obstacles: [
        { type: 'person', position: 'center', severity: 'high', distance: 'near', floor_hazard: 'no' }
      ],
      floor_hazards: [],
      blocked_directions: ['center'],
      alternative_directions: ['slightly left', 'slightly right'],
      recommended_direction: 'slightly right',
      walking_angle_degrees: 25,
      move_distance_feet: 10,
      action: 'move',
      urgency: 'high',
      path_status: 'partially_blocked',
      spoken_text: 'Person ahead. Move 25 degrees right for 10 feet.',
      reason: 'The center lane is blocked, but the right side looks open enough to pass safely.'
    },
    {
      obstacles: [
        { type: 'table', position: 'center', severity: 'high', distance: 'mid', floor_hazard: 'no' }
      ],
      floor_hazards: [
        { type: 'cable', position: 'center', distance: 'near', warning: 'Cable on the floor ahead.' }
      ],
      blocked_directions: ['center'],
      alternative_directions: ['right'],
      recommended_direction: 'right',
      walking_angle_degrees: 35,
      move_distance_feet: 8,
      action: 'move',
      urgency: 'high',
      path_status: 'partially_blocked',
      spoken_text: 'Cable and table ahead. Move 35 degrees right for 8 feet.',
      reason: 'The center path has both a floor hazard and a larger obstacle, so the right side is safer.'
    },
    {
      obstacles: [
        { type: 'mat', position: 'center', severity: 'medium', distance: 'near', floor_hazard: 'yes' }
      ],
      floor_hazards: [
        { type: 'mat', position: 'center', distance: 'near', warning: 'Watch out for a mat on the floor.' }
      ],
      blocked_directions: [],
      alternative_directions: ['forward', 'slightly left'],
      recommended_direction: 'forward',
      walking_angle_degrees: 0,
      move_distance_feet: 10,
      action: 'move',
      urgency: 'medium',
      path_status: 'mostly_clear',
      spoken_text: 'Mat ahead on the floor. Keep forward and watch your step for 10 feet.',
      reason: 'The path is mostly clear, but there is a floor hazard directly ahead.'
    },
    {
      obstacles: [
        { type: 'wall', position: 'left', severity: 'medium', distance: 'near', floor_hazard: 'no' },
        { type: 'chair', position: 'right', severity: 'medium', distance: 'near', floor_hazard: 'no' },
        { type: 'person', position: 'center', severity: 'high', distance: 'near', floor_hazard: 'no' }
      ],
      floor_hazards: [],
      blocked_directions: ['left', 'center', 'right'],
      alternative_directions: [],
      recommended_direction: 'stop',
      walking_angle_degrees: 0,
      move_distance_feet: 0,
      action: 'stop',
      urgency: 'high',
      path_status: 'blocked',
      spoken_text: 'Obstacle directly ahead. Stop.',
      reason: 'All visible directions look blocked or too tight for safe movement.'
    }
  ];

  const current = structuredClone(samples[Math.floor(Math.random() * samples.length)]);
  if (previousAnalysis && previousAnalysis.recommended_direction === current.recommended_direction) {
    if (current.recommended_direction === 'forward') {
      current.spoken_text = 'Still mostly clear. Keep forward for 10 feet.';
    } else if (current.recommended_direction === 'stop') {
      current.spoken_text = 'Still blocked. Stop.';
    } else {
      current.spoken_text = `Keep moving ${current.recommended_direction} for ${current.move_distance_feet} feet.`;
    }
  }
  return current;
}

async function analyzeFrame(imageDataUrl, previousAnalysis) {
  try {
    return await callOpenAI(imageDataUrl, previousAnalysis, true);
  } catch (firstError) {
    console.warn('Structured output attempt failed, retrying with plain JSON prompt.', firstError?.message || firstError);
    return await callOpenAI(imageDataUrl, previousAnalysis, false);
  }
}

async function callOpenAI(imageDataUrl, previousAnalysis, useStructuredOutput) {
  const previousSummary = previousAnalysis
    ? `Previous frame summary: recommended_direction=${previousAnalysis.recommended_direction || 'unknown'}, angle=${previousAnalysis.walking_angle_degrees ?? 0}, distance_feet=${previousAnalysis.move_distance_feet ?? 0}, action=${previousAnalysis.action || 'unknown'}, blocked_directions=${Array.isArray(previousAnalysis.blocked_directions) ? previousAnalysis.blocked_directions.join(',') : 'none'}, spoken_text=${previousAnalysis.spoken_text || 'none'}.`
    : 'No previous frame summary is available.';

  const systemPrompt = [
    'You are Argus, a navigation assistant helping a blind user walk more freely.',
    'Analyze one smartphone camera frame from the direction the user is facing.',
    'Do not caption the whole scene.',
    'Focus on movement decisions, obstacles in the current path, and hazards on the floor.',
    'Always think in walking lanes: left, center, right.',
    'Name the obstacles that actually matter for walking.',
    'If something is in the distance directly ahead, say that it is ahead in the direction the user is facing.',
    'If the current direction has an obstacle, provide the safest alternative direction.',
    'Give a walking angle in degrees relative to straight ahead. Negative is left, positive is right. Forward is 0.',
    'Give a short distance instruction in feet, usually 4 to 12 feet, unless stopping.',
    'Watch for floor hazards like cable, mat, carpet edge, bag, object on floor, wet floor, or threshold.',
    'If the path is unsafe or too uncertain, say stop.',
    'Prefer direct instructions such as: Move 20 degrees right for 8 feet.',
    'Keep spoken_text short, direct, and useful.'
  ].join(' ');

  const userPrompt = [
    'Return only JSON.',
    'Identify up to 4 major obstacles and up to 3 floor hazards.',
    previousSummary,
    'If the situation did not materially change, keep the new spoken_text brief instead of repeating a long sentence.',
    'If center is blocked and one side is open, recommend that side.',
    'If center is mostly clear but a floor hazard is present, warn about it and keep forward when safe.',
    'Use walking_angle_degrees to match the recommended direction.',
    'Use move_distance_feet as the short next instruction distance.',
    'If stopping, walking_angle_degrees must be 0 and move_distance_feet must be 0.',
    'Bad output: There is a person in front of you wearing dark clothes.',
    'Good output: Person ahead. Move 25 degrees right for 10 feet.'
  ].join(' ');

  const body = {
    model: MODEL,
    messages: [
      {
        role: 'developer',
        content: [{ type: 'text', text: systemPrompt }]
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUrl,
              detail: 'low'
            }
          }
        ]
      }
    ]
  };

  if (useStructuredOutput) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'argus_navigation_decision',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            obstacles: {
              type: 'array',
              maxItems: 4,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  type: { type: 'string' },
                  position: { type: 'string', enum: ['left', 'center', 'right', 'unknown'] },
                  severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                  distance: { type: 'string', enum: ['immediate', 'near', 'mid', 'far', 'unknown'] },
                  floor_hazard: { type: 'string', enum: ['yes', 'no'] }
                },
                required: ['type', 'position', 'severity', 'distance', 'floor_hazard']
              }
            },
            floor_hazards: {
              type: 'array',
              maxItems: 3,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  type: { type: 'string' },
                  position: { type: 'string', enum: ['left', 'center', 'right', 'unknown'] },
                  distance: { type: 'string', enum: ['immediate', 'near', 'mid', 'far', 'unknown'] },
                  warning: { type: 'string' }
                },
                required: ['type', 'position', 'distance', 'warning']
              }
            },
            blocked_directions: {
              type: 'array',
              items: { type: 'string', enum: ['left', 'center', 'right'] }
            },
            alternative_directions: {
              type: 'array',
              items: { type: 'string', enum: ['left', 'slightly left', 'forward', 'slightly right', 'right'] }
            },
            recommended_direction: {
              type: 'string',
              enum: ['left', 'slightly left', 'forward', 'slightly right', 'right', 'stop']
            },
            walking_angle_degrees: { type: 'integer' },
            move_distance_feet: { type: 'integer' },
            action: { type: 'string', enum: ['move', 'stop'] },
            urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
            path_status: { type: 'string', enum: ['clear', 'mostly_clear', 'partially_blocked', 'blocked', 'uncertain'] },
            spoken_text: { type: 'string' },
            reason: { type: 'string' }
          },
          required: [
            'obstacles',
            'floor_hazards',
            'blocked_directions',
            'alternative_directions',
            'recommended_direction',
            'walking_angle_degrees',
            'move_distance_feet',
            'action',
            'urgency',
            'path_status',
            'spoken_text',
            'reason'
          ]
        }
      }
    };
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const raw = await response.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI returned non-JSON: ${raw.slice(0, 300)}`);
  }

  if (!response.ok) {
    const message = data?.error?.message || raw || 'OpenAI request failed.';
    throw new Error(message);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('Model response content was empty.');
  }

  const parsed = tryParseJson(content);
  if (!parsed) {
    throw new Error(`Could not parse model JSON: ${content}`);
  }

  return normalizeAnalysis(parsed);
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeAnalysis(input) {
  const obstacles = Array.isArray(input.obstacles)
    ? input.obstacles.slice(0, 4).map((obstacle) => ({
        type: safeString(obstacle?.type, 'obstacle'),
        position: ['left', 'center', 'right', 'unknown'].includes(obstacle?.position)
          ? obstacle.position
          : 'unknown',
        severity: ['low', 'medium', 'high'].includes(obstacle?.severity) ? obstacle.severity : 'medium',
        distance: ['immediate', 'near', 'mid', 'far', 'unknown'].includes(obstacle?.distance)
          ? obstacle.distance
          : 'unknown',
        floor_hazard: obstacle?.floor_hazard === 'yes' ? 'yes' : 'no'
      }))
    : [];

  const floorHazards = Array.isArray(input.floor_hazards)
    ? input.floor_hazards.slice(0, 3).map((hazard) => ({
        type: safeString(hazard?.type, 'floor hazard'),
        position: ['left', 'center', 'right', 'unknown'].includes(hazard?.position)
          ? hazard.position
          : 'unknown',
        distance: ['immediate', 'near', 'mid', 'far', 'unknown'].includes(hazard?.distance)
          ? hazard.distance
          : 'unknown',
        warning: safeString(hazard?.warning, 'Watch your step.')
      }))
    : [];

  const blockedDirections = Array.isArray(input.blocked_directions)
    ? [...new Set(input.blocked_directions.filter((value) => ['left', 'center', 'right'].includes(value)))]
    : [];

  const alternativeDirections = Array.isArray(input.alternative_directions)
    ? [...new Set(input.alternative_directions.filter((value) => ['left', 'slightly left', 'forward', 'slightly right', 'right'].includes(value)))].slice(0, 3)
    : [];

  const recommendedDirection = ['left', 'slightly left', 'forward', 'slightly right', 'right', 'stop'].includes(input.recommended_direction)
    ? input.recommended_direction
    : 'forward';

  const action = ['move', 'stop'].includes(input.action)
    ? input.action
    : recommendedDirection === 'stop' ? 'stop' : 'move';

  const urgency = ['low', 'medium', 'high'].includes(input.urgency) ? input.urgency : 'medium';
  const pathStatus = ['clear', 'mostly_clear', 'partially_blocked', 'blocked', 'uncertain'].includes(input.path_status)
    ? input.path_status
    : 'uncertain';

  let walkingAngleDegrees = Number.isFinite(Number(input.walking_angle_degrees))
    ? Math.round(Number(input.walking_angle_degrees))
    : defaultAngle(recommendedDirection);
  walkingAngleDegrees = Math.max(-60, Math.min(60, walkingAngleDegrees));

  let moveDistanceFeet = Number.isFinite(Number(input.move_distance_feet))
    ? Math.round(Number(input.move_distance_feet))
    : defaultDistance(action, pathStatus);
  moveDistanceFeet = Math.max(0, Math.min(20, moveDistanceFeet));

  if (action === 'stop' || recommendedDirection === 'stop') {
    walkingAngleDegrees = 0;
    moveDistanceFeet = 0;
  }

  const spokenText = safeString(
    input.spoken_text,
    defaultSpokenText({ obstacles, floorHazards, recommendedDirection, walkingAngleDegrees, moveDistanceFeet, action, pathStatus })
  );
  const reason = safeString(input.reason, 'Model did not provide a reason.');

  return {
    obstacles,
    floor_hazards: floorHazards,
    blocked_directions: blockedDirections,
    alternative_directions: alternativeDirections,
    recommended_direction: recommendedDirection,
    walking_angle_degrees: walkingAngleDegrees,
    move_distance_feet: moveDistanceFeet,
    action,
    urgency,
    path_status: pathStatus,
    spoken_text: spokenText,
    reason
  };
}

function defaultAngle(recommendedDirection) {
  switch (recommendedDirection) {
    case 'left':
      return -35;
    case 'slightly left':
      return -20;
    case 'forward':
      return 0;
    case 'slightly right':
      return 20;
    case 'right':
      return 35;
    default:
      return 0;
  }
}

function defaultDistance(action, pathStatus) {
  if (action === 'stop') return 0;
  if (pathStatus === 'clear' || pathStatus === 'mostly_clear') return 10;
  return 6;
}

function defaultSpokenText({ obstacles, floorHazards, recommendedDirection, walkingAngleDegrees, moveDistanceFeet, action, pathStatus }) {
  const firstObstacle = obstacles[0];
  const firstFloorHazard = floorHazards[0];

  if (action === 'stop') {
    if (firstObstacle) return `${capitalize(firstObstacle.type)} ahead. Stop.`;
    return 'Obstacle ahead. Stop.';
  }

  const moveInstruction = movementText(recommendedDirection, walkingAngleDegrees, moveDistanceFeet);

  if (firstFloorHazard && !firstObstacle) {
    return `${capitalize(firstFloorHazard.type)} on the floor ${firstFloorHazard.position}. ${moveInstruction}`;
  }

  if (!firstObstacle) {
    if (pathStatus === 'clear' || pathStatus === 'mostly_clear') {
      return `Path mostly clear. ${moveInstruction}`;
    }
    return moveInstruction;
  }

  return `${capitalize(firstObstacle.type)} ${firstObstacle.position}. ${moveInstruction}`;
}

function movementText(direction, angle, feet) {
  if (direction === 'forward') {
    return `Keep forward for ${feet} feet.`;
  }
  if (direction === 'stop') {
    return 'Stop.';
  }
  const side = angle < 0 ? 'left' : 'right';
  const magnitude = Math.abs(angle) || (direction.includes('slightly') ? 20 : 35);
  return `Move ${magnitude} degrees ${side} for ${feet} feet.`;
}

function safeString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function capitalize(value) {
  if (!value) return 'Obstacle';
  return value.charAt(0).toUpperCase() + value.slice(1);
}
