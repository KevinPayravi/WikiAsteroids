'use strict';

// ------------------------------------------------------
// CONSTANTS & GAME CONFIGURATIONS
// ------------------------------------------------------
const POWERUP_TYPES = {
  HEART: 'heart',
  SHIELD: 'shield',
  FASTER_FIRE: 'fasterFire',
  EXPLOSION: 'explosion',
  SLOW_MOTION: 'slowMotion',
  TRIPLE_SHOT: 'tripleShot'
};

const GAME_CONFIG = {
  CANVAS: { WIDTH: 800, HEIGHT: 600 },
  GAMEPLAY: {
    MAX_ASTEROIDS: 25,
    BULLET_MAX_DISTANCE: 1200,
    SHOT_DELAY: {
      NORMAL: 200,
      FAST: 50
    }
  },
  POWERUP: {
    DURATION: {
      INVINCIBILITY: 420,
      FASTER_FIRE: 420,
      SLOW_MOTION: 420,
      SLOW_MOTION_TRANSITION: 120,
      TRIPLE_SHOT: 420
    }
  },
  PLAYER: {
    DAMAGE_INVULN_FRAMES: 180
  },
  WIKI: {
    SELECTED_WIKIS: new Set(
      JSON.parse(localStorage.getItem('selectedWikis')) || ['enwiki']
    ),
    WIKI_COUNTS: {}
  },
  TIME: {
    FIXED_TIMESTEP: 1000 / 60, // Target 60 FPS
    MAX_DELTA: 1000 / 30       // Cap delta if game falls behind
  }
};

// ------------------------------------------------------
// EVENT HANDLERS
// ------------------------------------------------------
const WikiEventHandler = {
  handleNewUser(data, langCode) {
    const username = `User:${data.user}`;
    const powerupTypes = [
      { type: POWERUP_TYPES.SHIELD, chance: 0.2 },
      { type: POWERUP_TYPES.FASTER_FIRE, chance: 0.4 },
      { type: POWERUP_TYPES.TRIPLE_SHOT, chance: 0.6 },
      { type: POWERUP_TYPES.EXPLOSION, chance: 0.8 },
      { type: POWERUP_TYPES.SLOW_MOTION, chance: 1.0 }
    ];

    const metadata = {
      lang: langCode,
      wiki: data.wiki,
      user: data.user,
      isNewUser: true
    };

    const rand = Math.random();
    const powerup = powerupTypes.find(p => rand < p.chance);
    if (powerup) {
      SpawnManager.spawnPowerup(powerup.type, username, metadata);
    }
  },

  handleArticleEdit(data, langCode) {
    if (data.namespace !== 0) return;
    const diff = data.length.new - data.length.old;
    const health = mapDiffToHealth(Math.abs(diff));

    SpawnManager.spawnAsteroid(data.title, health, {
      user: data.user || 'Unknown',
      diff_url: data.notify_url,
      diff_size: Math.abs(diff),
      diffSign: diff < 0 ? -1 : 1,
      lang: langCode,
      wiki: data.wiki
    });
  }
};

// ------------------------------------------------------
// GAME STATE
// ------------------------------------------------------
const gameState = {
  paused: false,
  gameOver: false,
  gameStarted: false,
  score: 0,
  lives: 3,
  keys: {},
  keysGamepad: {},
  targets: [],
  explosions: [],
  lastShotTime: 0,
  gameOverTimer: 0,
  asteroidCount: 0
};

// ------------------------------------------------------
// DOM ELEMENTS
// ------------------------------------------------------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const sidePanel = document.getElementById('sidePanel');

const mobileControls = {
  up: document.getElementById('btnUp'),
  left: document.getElementById('btnLeft'),
  right: document.getElementById('btnRight'),
  shoot: document.getElementById('btnShoot'),
  pause: document.getElementById('btnPause')
};

const W = canvas.width;
const H = canvas.height;
const shotDelayNormal = GAME_CONFIG.GAMEPLAY.SHOT_DELAY.NORMAL;
const shotDelayFast = GAME_CONFIG.GAMEPLAY.SHOT_DELAY.FAST;

// ------------------------------------------------------
// PLAYER STATE
// ------------------------------------------------------
const player = {
  x: GAME_CONFIG.CANVAS.WIDTH / 2,
  y: GAME_CONFIG.CANVAS.HEIGHT / 2,
  radius: 20,
  angle: 0,
  rotationSpeed: 0.05,
  speed: 0,
  maxSpeed: 10,
  friction: 0.985,
  color: '#00ff00',
  bullets: [],
  bulletSpeed: 7,
  damageInvulnFrames: 0,
  shieldFrames: 0,
  fasterFireFrames: 0,
  slowMotionFrames: 0,
  slowMotionTransition: 0,
  tripleShotFrames: 0,
  visible: true,
  vx: 0,
  vy: 0,
  thrust: 0.15
};

// ------------------------------------------------------
// SOUND SYSTEM
// ------------------------------------------------------
const SoundManager = {
  soundPaths: {
    pop: 'audio/pop.mp3',
    laser: 'audio/laser.mp3',
    laserTripleShot: 'audio/laser2.mp3',
    damaged: 'audio/damaged.mp3',
    acquireHeart: 'audio/powerupHeart.mp3',
    acquireInvincibility: 'audio/powerupShield.mp3',
    acquireFasterFire: 'audio/powerupFasterFire.mp3',
    acquireExplosion: 'audio/powerupExplosion.mp3',
    acquireSlowMotion: 'audio/powerupSlowMotion.mp3',
    acquireTripleShot: 'audio/powerupTripleShot.mp3',
    finalExplosion: 'audio/finalExplosion.mp3',
    gameToggle: 'audio/gameToggle.mp3',
    thrust: 'audio/thrust.mp3',
    powerupEnd: 'audio/powerupEnd.mp3',
    powerupSpawn: 'audio/powerupSpawn.mp3'
  },
  volumes: {
    hit: 0.7,
    pop: 0.4,
    laser: 0.3,
    laserTripleShot: 0.3,
    damaged: 0.8,
    acquireHeart: 0.6,
    acquireInvincibility: 0.6,
    acquireFasterFire: 0.6,
    acquireExplosion: 0.6,
    acquireSlowMotion: 0.6,
    acquireTripleShot: 0.6,
    finalExplosion: 1.0,
    gameToggle: 0.5,
    thrust: 0.3,
    powerupEnd: 0.4,
    powerupSpawn: 0.4
  },
  sounds: new Map(),
  muted: false,
  audioContext: null,
  buffers: new Map(),
  thrustSound: null,
  thrustGain: null,

  async init() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const loadSound = async key => {
      try {
        const response = await fetch(this.soundPaths[key]);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.buffers.set(key, audioBuffer);
      } catch (error) {
        console.warn(`Failed to load sound: ${key}`, error);
      }
    };

    await Promise.all(Object.keys(this.soundPaths).map(loadSound));

    this.thrustGain = this.audioContext.createGain();
    this.thrustGain.gain.value = this.volumes.thrust;
    this.thrustGain.connect(this.audioContext.destination);
  },

  play(soundName) {
    if (this.muted || !this.audioContext || !this.buffers.has(soundName)) return;
    try {
      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = this.volumes[soundName] || 1.0;

      source.buffer = this.buffers.get(soundName);
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      source.start(0);
    } catch (error) {
      console.warn(`Failed to play sound: ${soundName}`, error);
    }
  },

  startThrust() {
    if (this.muted || !this.audioContext || !this.buffers.has('thrust')) return;
    if (this.thrustSound) return; // already playing
    try {
      const source = this.audioContext.createBufferSource();
      source.buffer = this.buffers.get('thrust');
      source.loop = true;
      source.connect(this.thrustGain);
      source.start(0);
      this.thrustSound = source;
    } catch (error) {
      console.warn('Thrust sound failed:', error);
    }
  },

  stopThrust() {
    if (this.thrustSound) {
      try {
        this.thrustSound.stop();
      } catch (error) {
        console.warn('Stopping thrust failed:', error);
      }
      this.thrustSound = null;
    }
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopThrust();
    }
    return this.muted;
  }
};

// Initialize SoundManager after first click
document.addEventListener(
  'click',
  () => {
    if (!SoundManager.audioContext) {
      SoundManager.init().catch(console.error);
    }
  },
  { once: true }
);

// ------------------------------------------------------
// UTILITY FUNCTIONS
// ------------------------------------------------------
function isIPEditor(username) {
  // Regex to test for both IPv4 and IPv6
  const ipRegex = /^((^\s*((([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4]\d|25[0-5])\.){3}([0-9]|[1-9][0-9]|1\d\d|2[0-4]\d|25[0-5]))\s*$)|(^\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\s*$))$/;
  return ipRegex.test(username);
}

function truncateTitle(title, maxLen = 25) {
  return title.length > maxLen ? `${title.substring(0, maxLen)}...` : title;
}

function mapDiffToHealth(diff) {
  if (diff <= 20) return 1;
  if (diff <= 100) return 2;
  if (diff <= 300) return 3;
  if (diff <= 1000) return 4;
  return 5;
}

function distanceSquared(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

function prependSnippet(snippetDiv) {
  const articleList = document.querySelector('#sidePanel .articleList');
  articleList.insertBefore(snippetDiv, articleList.firstChild);
}

function wrapPosition(obj) {
  obj.x = (obj.x + W) % W;
  obj.y = (obj.y + H) % H;
}

// ------------------------------------------------------
// OFFSCREEN TEXT LABEL CREATION
// Should reduce memory usage by caching the canvas
// ------------------------------------------------------
const labelCanvasCache = new Map();
function createOffscreenLabelCanvas(text, font = '14px Anta', color = '#fff') {
  if (labelCanvasCache.has(text)) {
    return labelCanvasCache.get(text);
  }

  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.font = font;

  const padding = 6;
  const width = tempCtx.measureText(text).width + padding * 2;
  const height = 24; // approximate line height

  const offCanvas = document.createElement('canvas');
  offCanvas.width = width;
  offCanvas.height = height;

  const offCtx = offCanvas.getContext('2d');
  offCtx.font = font;
  offCtx.fillStyle = color;
  offCtx.textAlign = 'center';
  offCtx.textBaseline = 'middle';
  offCtx.fillText(text, width / 2, height / 2);

  labelCanvasCache.set(text, offCanvas);
  return offCanvas;
}

// ------------------------------------------------------
// SPAWN SYSTEM
// ------------------------------------------------------
const SpawnManager = {
  generateAsteroidShape(baseRadius) {
    const numVertices = 10;
    const vertices = [];
    for (let i = 0; i < numVertices; i++) {
      const angle = (i / numVertices) * Math.PI * 2;
      const rad = baseRadius * (0.8 + Math.random() * 0.4);
      vertices.push({ x: Math.cos(angle) * rad, y: Math.sin(angle) * rad });
    }
    return vertices;
  },

  spawnOffscreenTarget(title) {
    const spawnEdge = Math.floor(Math.random() * 4);
    const x = spawnEdge % 2 === 0
      ? Math.random() * W
      : spawnEdge === 1
        ? W
        : 0;
    const y = spawnEdge % 2 === 0
      ? spawnEdge === 0
        ? H
        : 0
      : Math.random() * H;
    return {
      x,
      y,
      title,
      speed: 1 + Math.random(),
      angleToCenter: Math.atan2(H / 2 - y, W / 2 - x)
    };
  },

  spawnAsteroid(title, health, metadata) {
    if (gameState.paused || !gameState.gameStarted || gameState.gameOver) return;
    if (gameState.asteroidCount >= GAME_CONFIG.GAMEPLAY.MAX_ASTEROIDS) return;

    const target = this.spawnOffscreenTarget(title);
    target.isAsteroid = true;
    target.health = health;
    target.healthBasedRadius = 10 + health * 5;
    target.metadata = metadata;
    target.diffSign = metadata.diffSign;
    target.baseRadius = 10 + health * 5;
    target.shape = this.generateAsteroidShape(target.baseRadius);

    const truncated = truncateTitle(title);
    target.labelCanvas = createOffscreenLabelCanvas(truncated);

    const centerX = W / 2;
    const centerY = H / 2;
    const angleToCenter = Math.atan2(centerY - target.y, centerX - target.x);
    const randomDeviation = (Math.random() - 0.5) * Math.PI * 0.66;
    target.angleToCenter = angleToCenter + randomDeviation;
    target.speed = 0.8 + Math.random() * 1.2;

    gameState.targets.push(target);
    gameState.asteroidCount++;
  },

  spawnPowerup(type, title, metadata) {
    if (gameState.paused || !gameState.gameStarted || gameState.gameOver) return;
    SoundManager.play('powerupSpawn');

    const target = this.spawnOffscreenTarget(title);
    target.metadata = metadata;

    const truncated = truncateTitle(title);
    target.labelCanvas = createOffscreenLabelCanvas(truncated);

    switch (type) {
      case POWERUP_TYPES.HEART:
        target.isHeart = true;
        break;
      case POWERUP_TYPES.SHIELD:
        target.isShield = true;
        break;
      case POWERUP_TYPES.FASTER_FIRE:
        target.isFasterFire = true;
        break;
      case POWERUP_TYPES.EXPLOSION:
        target.isExplosion = true;
        break;
      case POWERUP_TYPES.SLOW_MOTION:
        target.isSlowMotion = true;
        break;
      case POWERUP_TYPES.TRIPLE_SHOT:
        target.isTripleShot = true;
        break;
      default:
        console.warn(`Unknown powerup type: ${type}`);
        return;
    }
    gameState.targets.push(target);
  }
};

// ------------------------------------------------------
// ARTICLE SNIPPET MANAGER
// ------------------------------------------------------
const SnippetManager = {
  async fetchAndDisplay(wiki, target) {
    if (!target?.title) {
      console.warn('No title provided for snippet');
      return;
    }

    try {
      if (target.metadata?.isNewUser) {
        const snippetDiv = document.createElement('div');
        snippetDiv.className = 'articleSnippet articleSnippet--new';

        const showLangTag = GAME_CONFIG.WIKI.SELECTED_WIKIS.size > 1;
        const langTag = showLangTag && target.metadata.lang
          ? ` <span class="tag tag--lang">${target.metadata.lang}</span>`
          : '';

        snippetDiv.innerHTML = `
          <strong>
            Welcome ${target.metadata.user}! 🎉
            ${langTag}
          </strong>
          <div>A new Wikipedia editor has joined!</div>
        `;
        prependSnippet(snippetDiv);
        return;
      }

      const wikiCode = wiki.replace('wiki', '');
      const domain = `${wikiCode}.wikipedia.org`;
      const encodedTitle = encodeURIComponent(target.title);
      const url = `https://${domain}/api/rest_v1/page/summary/${encodedTitle}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.warn('Snippet fetch failed:', response.status, url);
        return;
      }

      const data = await response.json();
      const snippetDiv = document.createElement('div');
      snippetDiv.className = 'articleSnippet';
      const metadata = target.metadata || {};

      const showLangTag = GAME_CONFIG.WIKI.SELECTED_WIKIS.size > 1;
      const langTag = showLangTag && metadata.lang
        ? ` <span class="tag tag--lang">${metadata.lang}</span>`
        : '';

      if (metadata.newArticle) {
        snippetDiv.style.backgroundColor = '#445566';
      }

      const newTag = metadata.newArticle
        ? ' <span class="tag tag--new">New Article</span>'
        : '';

      let extraHTML = '';
      if (metadata.diff_url && metadata.diff_size !== undefined && metadata.user) {
        let displayUser = metadata.user;
        if (isIPEditor(displayUser)) {
          displayUser = 'IP editor';
        }
        const actionText = metadata.diffSign < 0 ? 'removed' : 'added';
        extraHTML = `
          <div class="extraInfo">
            <a href="${metadata.diff_url}" target="_blank">Edit</a> by ${displayUser} (${actionText} ${metadata.diff_size} bytes)
          </div>
        `;
      }

      snippetDiv.innerHTML = `
        <strong>
          <a href="https://${domain}/wiki/${encodedTitle}" target="_blank">
            ${target.title}
          </a>${newTag}${langTag}
        </strong>
        ${data.thumbnail
          ? `<img src="${data.thumbnail.source}" alt="Article Image" />`
          : ''
        }
        <div>${data.extract.length > 200
          ? data.extract.substring(0, 200) + '...'
          : data.extract || ''
        }</div>
        ${extraHTML}
      `;
      prependSnippet(snippetDiv);
    } catch (err) {
      console.error('Error handling snippet:', err);
    }
  }
};

// ------------------------------------------------------
// SIDEBAR
// ------------------------------------------------------
class SidebarManager {
  constructor() {
    this.sidePanel = document.getElementById('sidePanel');
    this.container = document.getElementById('sidebarContainer');
    this.toggleButton = document.getElementById('toggleSidebar');
    this.leftColumn = document.getElementById('leftColumn');
    this.isOpen = true;

    this.boundToggle = this.toggle.bind(this);
    this.toggleButton.addEventListener('click', this.boundToggle);
    this.initialize();
  }

  initialize() {
    this.updateButtonPosition();
    this.updateChevronDirection();
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.sidePanel.style.display = this.isOpen ? 'block' : 'none';
    this.container.classList.toggle('closed', !this.isOpen);

    if (this.isOpen) {
      this.leftColumn.style.maxWidth = 'calc(100% - 330px)';
      this.container.style.width = '300px';
    } else {
      this.leftColumn.style.maxWidth = 'min(1000px, 100%)';
      this.container.style.width = '0';
    }

    this.updateButtonPosition();
    this.updateChevronDirection();
  }

  updateButtonPosition() {
    this.toggleButton.style.left = this.isOpen ? '-30px' : '0px';
  }

  updateChevronDirection() {
    const chevron = this.isOpen ? '»' : '«';
    this.toggleButton.innerHTML = chevron;
  }

  destroy() {
    this.toggleButton.removeEventListener('click', this.boundToggle);
  }
}

// ------------------------------------------------------
// EVENT STREAM
// Recent changes from Wikimedia event stream
// ------------------------------------------------------
let eventSource = null;
function initializeEventSource() {
  if (eventSource) {
    eventSource.close();
  }
  eventSource = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange');
  eventSource.onmessage = handleWikiEvent;
  eventSource.onerror = handleEventSourceError;
}
initializeEventSource();

const WIKI_TO_LANG = {
  enwiki: 'EN', cawiki: 'CA', dewiki: 'DE', eswiki: 'ES',
  euwiki: 'EU', frwiki: 'FR', jawiki: 'JA', ruwiki: 'RU',
  zhwiki: 'ZH', ptwiki: 'PT', itwiki: 'IT', plwiki: 'PL',
  nlwiki: 'NL', svwiki: 'SV', viwiki: 'VI', trwiki: 'TR',
  ukwiki: 'UK', arwiki: 'AR', fawiki: 'FA'
};

function handleWikiEvent(event) {
  if (document.hidden) return;
  try {
    const data = JSON.parse(event.data);
    if (data.bot) return;
    if (!GAME_CONFIG.WIKI.SELECTED_WIKIS.has(data.wiki)) return;

    const langCode = WIKI_TO_LANG[data.wiki] || data.wiki.replace('wiki', '').toUpperCase();
    if (gameState.gameStarted && !gameState.paused && !gameState.gameOver) {
      GAME_CONFIG.WIKI.WIKI_COUNTS[data.wiki] = (GAME_CONFIG.WIKI.WIKI_COUNTS[data.wiki] || 0) + 1;
      const countSpan = document.querySelector(
        `.wikiToggle input[data-wiki="${data.wiki}"] + .articleCount`
      );
      if (countSpan) {
        countSpan.textContent = GAME_CONFIG.WIKI.WIKI_COUNTS[data.wiki];
      }

      if (data.type === 'log' && data.log_type === 'newusers') {
        WikiEventHandler.handleNewUser(data, langCode);
      } else if (data.namespace === 0) {
        if (
          data.type === 'new' &&
          !data.comment.toLowerCase().includes('redirect') &&
          data.length.new > 150
        ) {
          SpawnManager.spawnPowerup(POWERUP_TYPES.HEART, data.title, {
            lang: langCode,
            wiki: data.wiki,
            newArticle: true
          });
        } else if (data.length && data.length.old !== undefined && data.length.new !== undefined) {
          WikiEventHandler.handleArticleEdit(data, langCode);
        }
      }
    }
  } catch (err) {
    console.error('Error parsing SSE:', err);
  }
}

function handleEventSourceError(err) {
  console.log('EventSource error:', err);
}

// ------------------------------------------------------
// INPUT TOGGLES
// ------------------------------------------------------
function mapWASDToArrowKeys(keyCode) {
  switch (keyCode) {
    case 'KeyW':
    case 'KeyZ':
      return 'ArrowUp';
    case 'KeyA':
      return 'ArrowLeft';
    case 'KeyD':
      return 'ArrowRight';
    case 'KeyX':
      return 'Space';
    default:
      return keyCode;
  }
}

const keyboardController = {
  init() {
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
  },

  destroy() {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
  },

  handleKeyDown(e) {
    const mappedCode = mapWASDToArrowKeys(e.code);

    switch (e.code) {
      case 'KeyP':
        if (gameState.gameStarted && !gameState.gameOver) {
          gameState.paused = !gameState.paused;
          updatePauseButton();
          SoundManager.play('gameToggle');
        }
        return;
      case 'KeyR':
        restartGame();
        return;
      case 'KeyM': {
        const isMuted = SoundManager.toggleMute();
        updateMuteButtonIcon(document.getElementById('muteButton'), isMuted);
        return;
      }
      case 'KeyF':
        toggleFullscreen();
        return;
      case 'Enter':
        if (gameState.gameOver) {
          restartGame();
        } else if (!gameState.gameStarted) {
          startGame();
        }
        return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(mappedCode)) {
      e.preventDefault();
      if (mappedCode === 'Space' && !gameState.gameStarted && !gameState.gameOver) {
        startGame();
      } else if (mappedCode === 'Space' && !gameState.paused && !gameState.gameOver) {
        shoot();
      }
      updateMobileButtonState(mappedCode, true);
    }
    gameState.keys[mappedCode] = true;
  },

  handleKeyUp(e) {
    const mappedCode = mapWASDToArrowKeys(e.code);

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(mappedCode)) {
      e.preventDefault();
      updateMobileButtonState(mappedCode, false);
    }
    gameState.keys[mappedCode] = false;
  }
};
keyboardController.init();

// ------------------------------------------------------
// MOBILE CONTROLS
// ------------------------------------------------------
function initMobileControls() {
  const pointerDownEvents = ['mousedown', 'touchstart'];
  const pointerUpEvents = ['mouseup', 'touchend', 'mouseleave', 'touchcancel'];
  let shootInterval = null;

  const startShooting = () => {
    if (!gameState.gameStarted && !gameState.gameOver) {
      startGame();
    } else if (!gameState.paused && !gameState.gameOver) {
      shoot();
      shootInterval = setInterval(shoot, 10);
    }
  };

  const stopShooting = () => {
    if (shootInterval) {
      clearInterval(shootInterval);
      shootInterval = null;
    }
  };

  pointerDownEvents.forEach(eventName => {
    mobileControls.up.addEventListener(eventName, () => {
      gameState.keys.ArrowUp = true;
    });
    mobileControls.left.addEventListener(eventName, () => {
      gameState.keys.ArrowLeft = true;
    });
    mobileControls.right.addEventListener(eventName, () => {
      gameState.keys.ArrowRight = true;
    });
    mobileControls.shoot.addEventListener(eventName, startShooting);
  });

  pointerUpEvents.forEach(eventName => {
    mobileControls.up.addEventListener(eventName, () => {
      gameState.keys.ArrowUp = false;
    });
    mobileControls.left.addEventListener(eventName, () => {
      gameState.keys.ArrowLeft = false;
    });
    mobileControls.right.addEventListener(eventName, () => {
      gameState.keys.ArrowRight = false;
    });
    mobileControls.shoot.addEventListener(eventName, stopShooting);
  });
}

if (
  mobileControls.up &&
  mobileControls.left &&
  mobileControls.right &&
  mobileControls.shoot
) {
  initMobileControls();
}

// ------------------------------------------------------
// EXPLOSIONS
// ------------------------------------------------------
function spawnExplosion(x, y) {
  const numParticles = 15;
  const sparks = [];
  for (let i = 0; i < numParticles; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 2;
    sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 30 + Math.floor(Math.random() * 20),
      color: '#ffa500'
    });
  }
  gameState.explosions.push({ sparks });
}

function updateExplosions() {
  for (let i = gameState.explosions.length - 1; i >= 0; i--) {
    const e = gameState.explosions[i];
    for (let j = e.sparks.length - 1; j >= 0; j--) {
      const s = e.sparks[j];
      s.x += s.vx;
      s.y += s.vy;
      s.life--;
      if (s.life <= 0) {
        e.sparks.splice(j, 1);
      }
    }
    if (e.sparks.length === 0) {
      gameState.explosions.splice(i, 1);
    }
  }
}

function drawExplosions() {
  ctx.save();
  for (const explosion of gameState.explosions) {
    for (const spark of explosion.sparks) {
      ctx.fillStyle = spark.color;
      ctx.fillRect(spark.x, spark.y, 3, 3);
    }
  }
  ctx.restore();
}

function spawnFinalExplosion(x, y) {
  const sparks = [];
  const numSparks = 50;
  const speed = 5;
  const lifetime = 120;

  for (let i = 0; i < numSparks; i++) {
    const angle = (Math.PI * 2 * i) / numSparks;
    const velocity = speed * (0.5 + Math.random());
    sparks.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      life: lifetime,
      maxLife: lifetime,
      size: 4 + Math.random() * 4
    });
  }
  SoundManager.play('finalExplosion');
  gameState.explosions.push({ sparks });
}

// ------------------------------------------------------
// GAMEPAD CONTROLLER
// ------------------------------------------------------
const gamepadController = {
  deadzone: 0.1,
  startLock: false,

  update() {
    const gamepads = navigator.getGamepads?.() || [];
    let gamepad = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) {
        gamepad = gamepads[i];
        break;
      }
    }
    if (!gamepad) return;

    const startPressed = gamepad.buttons[9]?.pressed;
    const selectPressed = gamepad.buttons[8]?.pressed;
    if (startPressed || selectPressed) {
      if (!this.startLock) {
        if (gameState.gameOver) {
          restartGame();
        } else if (!gameState.gameStarted) {
          startGame();
        } else {
          gameState.paused = !gameState.paused;
          updatePauseButton();
          SoundManager.play('gameToggle');
        }
        this.startLock = true;
      }
    } else if (!startPressed && !selectPressed) {
      this.startLock = false;
    }

    if (!gameState.gameStarted || gameState.gameOver) return;
    if (gameState.paused) return;

    const leftX = gamepad.axes[0];
    const dpadLeft = gamepad.buttons[14]?.pressed;
    const dpadRight = gamepad.buttons[15]?.pressed;

    if (leftX < -this.deadzone || dpadLeft) {
      gameState.keysGamepad.ArrowLeft = true;
    } else {
      gameState.keysGamepad.ArrowLeft = false;
    }

    if (leftX > this.deadzone || dpadRight) {
      gameState.keysGamepad.ArrowRight = true;
    } else {
      gameState.keysGamepad.ArrowRight = false;
    }
    updateMobileButtonState('ArrowLeft', gameState.keysGamepad.ArrowLeft);
    updateMobileButtonState('ArrowRight', gameState.keysGamepad.ArrowRight);

    const leftY = gamepad.axes[1];
    const dpadUp = gamepad.buttons[12]?.pressed;
    const buttonA = gamepad.buttons[0]?.pressed;

    if (leftY < -this.deadzone || buttonA || dpadUp) {
      gameState.keysGamepad.ArrowUp = true;
    } else {
      gameState.keysGamepad.ArrowUp = false;
    }
    updateMobileButtonState('ArrowUp', gameState.keysGamepad.ArrowUp);

    const buttonX = gamepad.buttons[2]?.pressed;
    const buttonB = gamepad.buttons[1]?.pressed;
    const rightTrigger = gamepad.buttons[7]?.pressed;

    if (buttonX || buttonB || rightTrigger) {
      gameState.keysGamepad.Space = true;
    } else {
      gameState.keysGamepad.Space = false;
    }
    updateMobileButtonState('Space', gameState.keysGamepad.Space);
  }
};

// ------------------------------------------------------
// MAIN GAME UPDATE
// ------------------------------------------------------
function update(dt) {
  if (gameState.paused) return;

  if (gameState.gameOverTimer > 0) {
    gameState.gameOverTimer -= dt * 60;
    if (gameState.gameOverTimer <= 0) {
      gameState.gameOverTimer = 0;
      gameState.gameOver = true;
      SoundManager.stopThrust();
      const storedHighScore = localStorage.getItem('highScore') || 0;
      if (gameState.score > storedHighScore) {
        localStorage.setItem('highScore', gameState.score);
      }
    }
    updateExplosions();
    return;
  }

  // Player rotation
  if (gameState.keys.ArrowLeft || gameState.keysGamepad.ArrowLeft) {
    player.angle -= player.rotationSpeed * dt * 60;
  }
  if (gameState.keys.ArrowRight || gameState.keysGamepad.ArrowRight) {
    player.angle += player.rotationSpeed * dt * 60;
  }

  // Add thrust in the direction the ship is facing
  if (gameState.keys.ArrowUp || gameState.keysGamepad.ArrowUp) {
    const thrustX = Math.cos(player.angle) * player.thrust * dt * 60;
    const thrustY = Math.sin(player.angle) * player.thrust * dt * 60;
    player.vx += thrustX;
    player.vy += thrustY;
    SoundManager.startThrust();
  } else {
    SoundManager.stopThrust();
  }

  // Apply friction
  player.vx *= Math.pow(player.friction, dt * 60);
  player.vy *= Math.pow(player.friction, dt * 60);

  // Limit maxi speed
  const currentSpeed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
  if (currentSpeed > player.maxSpeed) {
    const scale = player.maxSpeed / currentSpeed;
    player.vx *= scale;
    player.vy *= scale;
  }

  // Update position based on velocity
  player.x += player.vx * dt * 60;
  player.y += player.vy * dt * 60;
  wrapPosition(player);

  // Shoot laser for spacebar
  if (gameState.keys.Space || gameState.keysGamepad.Space) {
    shoot();
  }

  // Update timers
  if (player.damageInvulnFrames > 0) player.damageInvulnFrames -= dt * 60;
  if (player.shieldFrames > 0) player.shieldFrames -= dt * 60;
  if (player.fasterFireFrames > 0) player.fasterFireFrames -= dt * 60;
  if (player.tripleShotFrames > 0) player.tripleShotFrames -= dt * 60;

  // Update slow motion
  if (player.slowMotionFrames > 0) {
    player.slowMotionFrames -= dt * 60;
    if (player.slowMotionFrames <= 0) {
      player.slowMotionFrames = 0;
      player.slowMotionTransition = GAME_CONFIG.POWERUP.DURATION.SLOW_MOTION_TRANSITION;
    }
  }
  if (player.slowMotionTransition > 0) {
    player.slowMotionTransition -= dt * 60;
  }

  // Calculate slow motion effect
  let speedMultiplier = 1;
  if (player.slowMotionFrames > 0) {
    if (player.slowMotionTransition > 0) {
      const progress = 1 - player.slowMotionTransition /
        GAME_CONFIG.POWERUP.DURATION.SLOW_MOTION_TRANSITION;
      speedMultiplier = 1 - 0.8 * progress;
    } else {
      speedMultiplier = 0.2;
    }
  } else if (player.slowMotionTransition > 0) {
    const progress = 1 - player.slowMotionTransition /
      GAME_CONFIG.POWERUP.DURATION.SLOW_MOTION_TRANSITION;
    speedMultiplier = 0.2 + 0.8 * progress;
  }

  // Update bullets
  for (let i = player.bullets.length - 1; i >= 0; i--) {
    const bullet = player.bullets[i];
    const oldX = bullet.x;
    const oldY = bullet.y;

    bullet.x += bullet.vx * dt * 60;
    bullet.y += bullet.vy * dt * 60;
    wrapPosition(bullet);

    if (bullet.traveledDistance === undefined) bullet.traveledDistance = 0;
    const dxFrame = bullet.x - oldX;
    const dyFrame = bullet.y - oldY;
    const distFrame = Math.sqrt(dxFrame * dxFrame + dyFrame * dyFrame);
    bullet.traveledDistance += distFrame;

    if (bullet.traveledDistance > GAME_CONFIG.GAMEPLAY.BULLET_MAX_DISTANCE) {
      player.bullets.splice(i, 1);
    }
  }

  // Update targets
  const targetsToProcess = [...gameState.targets];
  for (let i = targetsToProcess.length - 1; i >= 0; i--) {
    const t = targetsToProcess[i];
    if (!t) continue;

    t.x += t.speed * Math.cos(t.angleToCenter) * speedMultiplier * dt * 60;
    t.y += t.speed * Math.sin(t.angleToCenter) * speedMultiplier * dt * 60;
    wrapPosition(t);

    if (t.isAsteroid) {
      const radiusSq = t.healthBasedRadius * t.healthBasedRadius;
      for (let j = player.bullets.length - 1; j >= 0; j--) {
        const bullet = player.bullets[j];
        const distSq = distanceSquared(t.x, t.y, bullet.x, bullet.y);
        if (distSq < radiusSq) {
          t.health--;
          t.healthBasedRadius = 10 + t.health * 5;
          gameState.score++;
          player.bullets.splice(j, 1);

          if (t.health <= 0) {
            SoundManager.play('pop');
            spawnExplosion(t.x, t.y);
            const removed = gameState.targets.splice(i, 1)[0];
            if (removed.labelCanvas) removed.labelCanvas = null;
            SnippetManager.fetchAndDisplay(removed.metadata?.wiki || 'enwiki', removed);
            gameState.asteroidCount--;
          } else {
            SoundManager.play('pop');
          }
          break;
        }
      }
    }

    const dx = t.x - player.x;
    const dy = t.y - player.y;
    const distSq = dx * dx + dy * dy;
    const combined = (t.isAsteroid ? t.healthBasedRadius : 20) + player.radius;
    if (distSq < combined * combined) {
      const isInvincible = player.shieldFrames > 0 || player.damageInvulnFrames > 0;

      if (t.isHeart) {
        SoundManager.play('acquireHeart');
        const removed = gameState.targets.splice(i, 1)[0];
        if (removed.labelCanvas) removed.labelCanvas = null;
        SnippetManager.fetchAndDisplay(removed.metadata?.wiki || 'enwiki', removed);
        gameState.lives++;
      } else if (t.isShield) {
        SoundManager.play('acquireInvincibility');
        const removed = gameState.targets.splice(i, 1)[0];
        if (removed.labelCanvas) removed.labelCanvas = null;
        SnippetManager.fetchAndDisplay(removed.metadata?.wiki || 'enwiki', removed);
        player.shieldFrames = GAME_CONFIG.POWERUP.DURATION.INVINCIBILITY;
      } else if (t.isFasterFire) {
        SoundManager.play('acquireFasterFire');
        const removed = gameState.targets.splice(i, 1)[0];
        if (removed.labelCanvas) removed.labelCanvas = null;
        SnippetManager.fetchAndDisplay(removed.metadata?.wiki || 'enwiki', removed);
        player.fasterFireFrames = GAME_CONFIG.POWERUP.DURATION.FASTER_FIRE;
      } else if (t.isExplosion) {
        SoundManager.play('acquireExplosion');
        const removed = gameState.targets.splice(i, 1)[0];
        if (removed.labelCanvas) removed.labelCanvas = null;
        SnippetManager.fetchAndDisplay(removed.metadata?.wiki || 'enwiki', removed);

        let pointsGained = 0;
        const asteroidsToDestroy = gameState.targets.filter(obj => obj.isAsteroid);
        asteroidsToDestroy.forEach(asteroid => {
          pointsGained += asteroid.health || 0;
          spawnExplosion(asteroid.x, asteroid.y);
          const asteroidIndex = gameState.targets.indexOf(asteroid);
          if (asteroidIndex !== -1) {
            const removedAsteroid = gameState.targets.splice(asteroidIndex, 1)[0];
            if (removedAsteroid.labelCanvas) removedAsteroid.labelCanvas = null;
            SnippetManager.fetchAndDisplay(
              removedAsteroid.metadata?.wiki || 'enwiki',
              removedAsteroid
            );
            gameState.asteroidCount--;
          }
        });
        gameState.score += pointsGained;
      } else if (t.isSlowMotion) {
        SoundManager.play('acquireSlowMotion');
        const removed = gameState.targets.splice(i, 1)[0];
        if (removed.labelCanvas) removed.labelCanvas = null;
        SnippetManager.fetchAndDisplay(removed.metadata?.wiki || 'enwiki', removed);

        if (player.slowMotionFrames === 0) {
          if (player.slowMotionTransition > 0) {
            player.slowMotionTransition =
              GAME_CONFIG.POWERUP.DURATION.SLOW_MOTION_TRANSITION - player.slowMotionTransition;
          } else {
            player.slowMotionTransition = GAME_CONFIG.POWERUP.DURATION.SLOW_MOTION_TRANSITION;
          }
        }
        player.slowMotionFrames = GAME_CONFIG.POWERUP.DURATION.SLOW_MOTION;
      } else if (t.isTripleShot) {
        SoundManager.play('acquireTripleShot');
        const removed = gameState.targets.splice(i, 1)[0];
        if (removed.labelCanvas) removed.labelCanvas = null;
        SnippetManager.fetchAndDisplay(removed.metadata?.wiki || 'enwiki', removed);
        player.tripleShotFrames = GAME_CONFIG.POWERUP.DURATION.TRIPLE_SHOT;
      } else if (t.isAsteroid && !isInvincible) {
        SoundManager.play('damaged');
        t.health--;
        t.healthBasedRadius = 10 + t.health * 5;
        if (t.health <= 0) {
          spawnExplosion(t.x, t.y);
          const removed = gameState.targets.splice(i, 1)[0];
          if (removed.labelCanvas) removed.labelCanvas = null;
          SnippetManager.fetchAndDisplay(removed.metadata?.wiki || 'enwiki', removed);
          gameState.asteroidCount--;
        }
        gameState.lives--;
        if (gameState.lives <= 0) {
          spawnFinalExplosion(player.x, player.y);
          player.visible = false;
          gameState.gameOverTimer = 120;
          SoundManager.stopThrust();
        } else {
          player.damageInvulnFrames = GAME_CONFIG.PLAYER.DAMAGE_INVULN_FRAMES;
        }
      }
    }
  }

  // Powerup warning sound (about to end)
  if (
    (player.shieldFrames > 0 && player.shieldFrames <= 120 * dt) ||
    (player.fasterFireFrames > 0 && player.fasterFireFrames <= 120 * dt) ||
    (player.tripleShotFrames > 0 && player.tripleShotFrames <= 120 * dt)
  ) {
    SoundManager.play('powerupEnd');
  }

  updateExplosions();
}

// ------------------------------------------------------
// DRAW FUNCTIONS
// ------------------------------------------------------
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (gameState.gameOver) {
    drawGameOver();
    return;
  }

  if (!gameState.gameOverTimer && player.visible) {
    drawPlayer();
  }

  const bulletColor = player.fasterFireFrames > 0 ? '#ffff00' : '#fff';
  ctx.fillStyle = bulletColor;
  for (const bullet of player.bullets) {
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const t of gameState.targets) {
    if (t.isHeart) {
      drawHeart(t.x, t.y, 20);
    } else if (t.isAsteroid) {
      ctx.save();
      ctx.translate(t.x, t.y);
      const currentRadius = t.healthBasedRadius;
      const scale = currentRadius / t.baseRadius;
      ctx.beginPath();
      for (let i = 0; i < t.shape.length; i++) {
        const vx = t.shape[i].x * scale;
        const vy = t.shape[i].y * scale;
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      const color = t.diffSign && t.diffSign < 0 ? '#a08080' : '#80a0c0';
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    } else if (t.isShield) {
      drawPowerupShield(t.x, t.y, 15);
    } else if (t.isFasterFire) {
      drawPowerupFasterFire(t.x, t.y, 15);
    } else if (t.isExplosion) {
      drawPowerupExplosion(t.x, t.y, 15);
    } else if (t.isSlowMotion) {
      drawPowerupSlowMotion(t.x, t.y, 15);
    } else if (t.isTripleShot) {
      drawPowerupTripleShot(t.x, t.y, 15);
    }

    if (t.labelCanvas) {
      const labelOffset = 25;
      const dx = t.x - t.labelCanvas.width / 2;
      const dy = t.y - labelOffset - t.labelCanvas.height / 2;
      ctx.drawImage(t.labelCanvas, dx, dy);
    }
  }

  drawExplosions();
  drawScore();
  drawLives();

  if (gameState.paused) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = '48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', W / 2, H / 2);
    ctx.restore();
  }

  if (!gameState.gameStarted) {
    drawStartButton();
  } else if (gameState.gameOver) {
    drawRestartButton();
  }
}

function drawGameOver() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = '48px Anta';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GAME OVER', W / 2, H / 2 - 20);
  const highScore = localStorage.getItem('highScore') || 0;
  ctx.font = '24px Anta';
  ctx.fillText(`Score: ${gameState.score}   High Score: ${highScore}`, W / 2, H / 2 + 30);
  drawRestartButton();
  ctx.restore();
}

function drawPlayer() {
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.angle);

  // Thrust flame
  if (gameState.keys.ArrowUp || gameState.keysGamepad.ArrowUp) {
    ctx.beginPath();
    ctx.moveTo(-player.radius, player.radius * 0.3);
    ctx.lineTo(-player.radius - 10, 0);
    ctx.lineTo(-player.radius, -player.radius * 0.3);
    ctx.closePath();
    ctx.fillStyle = 'orange';
    ctx.fill();
  }

  // Flicker effect if invulnerable
  if (player.damageInvulnFrames > 0) {
    if (Math.floor(player.damageInvulnFrames / 5) % 2 === 0) {
      ctx.restore();
      return;
    }
  }

  ctx.beginPath();
  ctx.moveTo(player.radius, 0);
  ctx.lineTo(-player.radius, player.radius / 2);
  ctx.lineTo(-player.radius, -player.radius / 2);
  ctx.closePath();
  ctx.fillStyle = player.color;
  ctx.fill();
  ctx.restore();

  if (player.shieldFrames > 0) {
    let ringShouldDraw = true;
    if (player.shieldFrames < 120) {
      if (Math.floor(player.shieldFrames / 5) % 2 === 0) {
        ringShouldDraw = false;
      }
    }
    if (ringShouldDraw) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,255,255,0.5)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawHeart(x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#ff0000';
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.25);
  ctx.bezierCurveTo(
    -size * 0.5,
    -size * 0.5,
    -size * 0.5,
    size * 0.2,
    0,
    size * 0.4
  );
  ctx.bezierCurveTo(
    size * 0.5,
    size * 0.2,
    size * 0.5,
    -size * 0.5,
    0,
    -size * 0.25
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPowerupShield(x, y, radius) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#00ffff';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function drawPowerupFasterFire(x, y, radius) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = '#ffff00';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function drawStar(cx, cy, spikes, outerRadius, innerRadius, fillColor) {
  const step = Math.PI / spikes;
  ctx.beginPath();
  for (let i = 0; i < 2 * spikes; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = i * step;
    const sx = cx + Math.cos(angle) * r;
    const sy = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
}

function drawPowerupExplosion(x, y, radius) {
  drawStar(x, y, 10, radius, radius * 0.5, '#ff9900');
}

function drawPowerupSlowMotion(x, y, radius) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#9966ff';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -radius * 0.7);
  ctx.moveTo(0, 0);
  ctx.lineTo(radius * 0.7, 0);
  ctx.strokeStyle = '#9966ff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawPowerupTripleShot(x, y, radius) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#ff66ff';
  const dotRadius = radius * 0.25;

  ctx.beginPath();
  ctx.arc(0, -radius / 2, dotRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(-radius / 2, radius / 2, dotRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(radius / 2, radius / 2, dotRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawScore() {
  ctx.save();
  ctx.font = '20px Anta';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const highScore = localStorage.getItem('highScore') || 0;
  ctx.fillText(`Score: ${gameState.score}   High Score: ${highScore}`, 30, 20);
  ctx.restore();
}

function drawLives() {
  ctx.save();
  ctx.font = '20px Anta';
  ctx.fillStyle = '#ff0000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const baseX = 30;
  const baseY = 50;
  for (let i = 0; i < gameState.lives; i++) {
    ctx.fillText('♥', baseX + i * 25, baseY);
  }
  ctx.restore();
}

// ------------------------------------------------------
// SHOOT FUNCTION
// ------------------------------------------------------
function shoot() {
  const now = performance.now();
  const currentDelay = player.fasterFireFrames > 0 ? shotDelayFast : shotDelayNormal;
  if (now - gameState.lastShotTime < currentDelay) return;

  SoundManager.play(player.tripleShotFrames > 0 ? 'laserTripleShot' : 'laser');
  gameState.lastShotTime = now;

  const bulletSpeed = player.bulletSpeed;
  const baseAngle = player.angle;

  const createBullet = angle => ({
    x: player.x + Math.cos(angle) * player.radius,
    y: player.y + Math.sin(angle) * player.radius,
    vx: bulletSpeed * Math.cos(angle),
    vy: bulletSpeed * Math.sin(angle),
    traveledDistance: 0
  });

  player.bullets.push(createBullet(baseAngle));
  if (player.tripleShotFrames > 0) {
    const spread = Math.PI / 12;
    player.bullets.push(createBullet(baseAngle + spread));
    player.bullets.push(createBullet(baseAngle - spread));
  }
}

// ------------------------------------------------------
// MAIN GAME LOOP
// ------------------------------------------------------
let animationFrameId = null;
function startGameLoop() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  const gameLoop = timestamp => {
    timeState.currentTime = timestamp;
    if (!timeState.lastTime) {
      timeState.lastTime = timestamp;
    }

    // Calculate delta time in seconds
    timeState.deltaTime = Math.min(
      timeState.currentTime - timeState.lastTime,
      GAME_CONFIG.TIME.MAX_DELTA
    ) / 1000;

    timeState.lastTime = timeState.currentTime;
    gamepadController.update();

    if (!gameState.gameOver && gameState.gameStarted) {
      update(timeState.deltaTime);
    }

    draw();
    animationFrameId = requestAnimationFrame(gameLoop);
  };

  animationFrameId = requestAnimationFrame(gameLoop);
}

function restartGame() {
  SoundManager.play('gameToggle');
  resetGameState();
  canvas.focus();
}

startGameLoop();

// ------------------------------------------------------
// SIDEBAR INIT
// ------------------------------------------------------
const sidebarManager = new SidebarManager();

// ------------------------------------------------------
// CLEANUP ON PAGE UNLOAD
// ------------------------------------------------------
window.addEventListener('unload', () => {
  if (eventSource) {
    eventSource.close();
  }
  SoundManager.stopThrust();
});

// ------------------------------------------------------
// LANGUAGE SELECTOR
// ------------------------------------------------------
document.querySelectorAll('.wikiToggle input').forEach(checkbox => {
  const wiki = checkbox.dataset.wiki;
  checkbox.checked = GAME_CONFIG.WIKI.SELECTED_WIKIS.has(wiki);
  if (checkbox.checked) {
    checkbox.parentElement.classList.add('active');
  }
  const countSpan = checkbox.parentElement.querySelector('.articleCount');
  if (countSpan) {
    countSpan.textContent = '0';
  }

  checkbox.addEventListener('change', function () {
    const wikiCode = this.dataset.wiki;
    if (this.checked) {
      GAME_CONFIG.WIKI.SELECTED_WIKIS.add(wikiCode);
      this.parentElement.classList.add('active');
      GAME_CONFIG.WIKI.WIKI_COUNTS[wikiCode] = 0;
    } else {
      GAME_CONFIG.WIKI.SELECTED_WIKIS.delete(wikiCode);
      this.parentElement.classList.remove('active');
      GAME_CONFIG.WIKI.WIKI_COUNTS[wikiCode] = 0;
    }
    const countSpan = this.parentElement.querySelector('.articleCount');
    if (countSpan) {
      countSpan.textContent = '0';
    }
    localStorage.setItem(
      'selectedWikis',
      JSON.stringify([...GAME_CONFIG.WIKI.SELECTED_WIKIS])
    );
  });
});

// ------------------------------------------------------
// FULLSCREEN HANDLING
// ------------------------------------------------------
const fullscreenButton = document.getElementById('fullscreenButton');
const canvasContainer = document.querySelector('.canvasContainer');

function toggleFullscreen() {
  const container = canvasContainer;
  const isFull =
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    container.classList.contains('fullscreen');

  if (isFull) {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (document.webkitFullscreenElement) {
      document.webkitExitFullscreen();
    } else if (document.mozFullScreenElement) {
      document.mozCancelFullScreen();
    } else if (document.msFullscreenElement) {
      document.msExitFullscreen();
    }
    container.classList.remove('fullscreen');
    document.body.style.overflow = '';
  } else {
    container.classList.add('fullscreen');
    document.body.style.overflow = 'hidden';
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (document.webkitFullscreenElement) {
      document.webkitExitFullscreen();
    } else if (document.mozFullScreenElement) {
      document.mozCancelFullScreen();
    } else if (document.msFullscreenElement) {
      document.msExitFullscreen();
    }
    canvas.focus();
  }
}

fullscreenButton.addEventListener('click', () => {
  toggleFullscreen();
});

// ------------------------------------------------------
// MOBILE PAUSE BUTTON
// ------------------------------------------------------
if (mobileControls.pause) {
  mobileControls.pause.addEventListener('click', () => {
    gameState.paused = !gameState.paused;
    updatePauseButton();
    SoundManager.play('gameToggle');
  });
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

// ------------------------------------------------------
// RESET GAME STATE
// ------------------------------------------------------
function resetGameState() {
  SoundManager.stopThrust();

  gameState.paused = false;
  gameState.gameOver = false;
  gameState.score = 0;
  gameState.lives = 3;
  gameState.targets = [];
  gameState.explosions = [];
  gameState.lastShotTime = 0;
  gameState.gameOverTimer = 0;
  gameState.asteroidCount = 0;

  player.x = GAME_CONFIG.CANVAS.WIDTH / 2;
  player.y = GAME_CONFIG.CANVAS.HEIGHT / 2;
  player.angle = 0;
  player.speed = 0;
  player.bullets = [];
  player.shieldFrames = 0;
  player.fasterFireFrames = 0;
  player.slowMotionFrames = 0;
  player.slowMotionTransition = 0;
  player.damageInvulnFrames = 0;
  player.tripleShotFrames = 0;
  player.visible = true;
  player.vx = 0;
  player.vy = 0;
  player.thrust = 0.15;
}

// ------------------------------------------------------
// RESTART LOGIC
// ------------------------------------------------------
function drawRestartButton() {
  if (!gameState.gameOver) return;
  const buttonWidth = 160;
  const buttonHeight = 50;
  const x = W / 2 - buttonWidth / 2;
  const y = H * 0.6;
  const radius = 5;

  ctx.beginPath();
  drawRoundedRect(ctx, x, y, buttonWidth, buttonHeight, radius);
  ctx.save();
  ctx.fillStyle = '#444';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = '24px Anta';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('RESTART', W / 2, y + buttonHeight / 2);
  ctx.restore();

  gameState.restartBounds = { x, y, width: buttonWidth, height: buttonHeight };
}

// ------------------------------------------------------
// UPDATE ON-SCREEN PLAY BUTTON STATES
// ------------------------------------------------------
function updatePauseButton() {
  if (mobileControls.pause) {
    mobileControls.pause.innerHTML = gameState.paused ? '▶' : 'II';
  }
}

function updateMobileButtonState(keyCode, isPressed) {
  switch (keyCode) {
    case 'ArrowUp':
      mobileControls.up?.classList.toggle('pressed', isPressed);
      break;
    case 'ArrowLeft':
      mobileControls.left?.classList.toggle('pressed', isPressed);
      break;
    case 'ArrowRight':
      mobileControls.right?.classList.toggle('pressed', isPressed);
      break;
    case 'Space':
      mobileControls.shoot?.classList.toggle('pressed', isPressed);
      break;
  }
}

// ------------------------------------------------------
// START BUTTON
// ------------------------------------------------------
function drawStartButton() {
  if (gameState.gameStarted) return;
  const buttonWidth = 160;
  const buttonHeight = 50;
  const x = W / 2 - buttonWidth / 2;
  const y = H * 0.6;
  const radius = 5;

  ctx.beginPath();
  drawRoundedRect(ctx, x, y, buttonWidth, buttonHeight, radius);
  ctx.save();
  ctx.fillStyle = '#444';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = '24px Anta';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('START GAME', W / 2, y + buttonHeight / 2);
  ctx.restore();

  gameState.startBounds = { x, y, width: buttonWidth, height: buttonHeight };
}

function startGame() {
  SoundManager.play('gameToggle');
  gameState.gameStarted = true;
  canvas.focus();
}

canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);

  // Start button
  if (!gameState.gameStarted && gameState.startBounds) {
    const bounds = gameState.startBounds;
    if (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    ) {
      startGame();
    }
  }

  // Restart button
  if (gameState.gameOver && gameState.restartBounds) {
    const bounds = gameState.restartBounds;
    if (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    ) {
      restartGame();
    }
  }
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);

  if (!gameState.gameStarted && gameState.startBounds) {
    const bounds = gameState.startBounds;
    if (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    ) {
      canvas.style.cursor = 'pointer';
      return;
    }
  }

  if (gameState.gameOver && gameState.restartBounds) {
    const bounds = gameState.restartBounds;
    if (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    ) {
      canvas.style.cursor = 'pointer';
      return;
    }
  }
  canvas.style.cursor = 'default';
});

document.addEventListener(
  'click',
  () => {
    if (SoundManager.soundPaths.thrust) {
      // Intentionally left blank to trigger sound
    }
  },
  { once: true }
);

// ------------------------------------------------------
// MUTE BUTTON
// ------------------------------------------------------
function addMuteButton() {
  const muteButton = document.createElement('button');
  muteButton.id = 'muteButton';
  muteButton.className = 'gameButton';
  muteButton.setAttribute('aria-label', 'Toggle sound');
  muteButton.style.right = '50px';

  updateMuteButtonIcon(muteButton, SoundManager.muted);
  muteButton.addEventListener('click', () => {
    const isMuted = SoundManager.toggleMute();
    updateMuteButtonIcon(muteButton, isMuted);
  });

  document.querySelector('.canvasContainer').appendChild(muteButton);
}

function updateMuteButtonIcon(button, isMuted) {
  button.innerHTML = isMuted
    ? '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#fff" d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25 .71.61 .85C17.18 6.54 19 9.06 19 12zm-8.71-6.29l-.17.17L12 7.76V6.41c0-.89-1.08-1.33-1.71-.7zM16.5 12c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#fff" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
}

// ------------------------------------------------------
// ON-SCREEN CONTROLS TOGGLE BUTTON
// ------------------------------------------------------
function addToggleControlsButton() {
  const toggleButton = document.createElement('button');
  toggleButton.id = 'toggleControlsButton';
  toggleButton.className = 'gameButton';
  toggleButton.setAttribute('aria-label', 'Toggle on-screen controls');

  const defaultVisible = window.innerWidth <= 900;
  const controlsVisible = localStorage.getItem('controlsVisible') !== null
    ? localStorage.getItem('controlsVisible') === 'true'
    : defaultVisible;

  updateToggleControlsIcon(toggleButton, controlsVisible);

  if (mobileControls) {
    const mobileControlsDiv = document.getElementById('mobileControls');
    if (mobileControlsDiv) {
      mobileControlsDiv.style.display = controlsVisible ? 'block' : 'none';
    }

    toggleButton.addEventListener('click', () => {
      const isVisible = mobileControlsDiv.style.display !== 'none';
      mobileControlsDiv.style.display = isVisible ? 'none' : 'block';
      updateToggleControlsIcon(toggleButton, !isVisible);
      localStorage.setItem('controlsVisible', !isVisible);
    });
  }
  document.querySelector('.canvasContainer').appendChild(toggleButton);
}

function updateToggleControlsIcon(button, isVisible) {
  // If visible, show a gamepad icon; if hidden, show a crossed-out gamepad
  button.innerHTML = isVisible
    ? `<svg width="16" height="16" viewBox="0 0 24 24">
         <path fill="#fff" d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
       </svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24">
         <path fill="#fff" d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
         <path fill="#fff" d="M2 2L22 22" stroke="#fff" stroke-width="3"/>
         <path fill="#fff" d="M22 2L2 22" stroke="#fff" stroke-width="3"/>
       </svg>`;
}

document.head.appendChild(document.createElement('style'));

addMuteButton();
addToggleControlsButton();

const timeState = {
  lastTime: 0,
  deltaTime: 0,
  currentTime: 0
};
