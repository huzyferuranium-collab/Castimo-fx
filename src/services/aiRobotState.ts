// Castimo AI Market Scanner & Humanoid Robot State Machine

export type RobotState = 'SCANNING' | 'ANALYZING' | 'SIGNAL_DETECTED' | 'CONFIRMING' | 'WAITING';

export interface MarketItem {
  symbol: string;
  displaySymbol: string;
  price: number;
  changePct: number;
  status: 'SCANNING' | 'ANALYZING' | 'WAITING' | 'SIGNAL';
  direction?: 'BUY' | 'SELL';
  confidence?: number;
  high: number;
  low: number;
  spread: number;
}

export interface TechnicalMetrics {
  rsi: number;
  macd: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  momentum: 'STRONG' | 'MODERATE' | 'WEAK';
  volume: 'HIGH' | 'NORMAL' | 'LOW';
  liquidity: 'OPTIMAL' | 'GOOD' | 'MODERATE';
  volatility: 'MODERATE' | 'EXPANDING' | 'LOW';
}

export interface AiSignal {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  confidence: number;
  timeframe: string;
  analysis: string;
  timestamp: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
}

export interface ActivityLogEntry {
  id: string;
  time: string;
  text: string;
  type: 'scan' | 'analyze' | 'signal' | 'system';
}

export interface AiRobotState {
  state: RobotState;
  currentTask: string;
  currentMarket: string;
  timeframe: string;
  progress: number;
  confidence: number;
  isOnline: boolean;
  metrics: TechnicalMetrics;
  markets: MarketItem[];
  currentSignal: AiSignal | null;
  recentSignals: AiSignal[];
  logs: ActivityLogEntry[];
  soundEnabled: boolean;
}

const INITIAL_MARKETS: MarketItem[] = [
  {
    symbol: 'XAUUSD',
    displaySymbol: 'XAU/USD',
    price: 2651.8,
    changePct: +0.65,
    status: 'ANALYZING',
    direction: 'BUY',
    confidence: 84,
    high: 2664.5,
    low: 2642.0,
    spread: 1.2,
  },
];

const INITIAL_RECENT_SIGNALS: AiSignal[] = [
  {
    id: 'sig-1',
    symbol: 'XAU/USD',
    direction: 'BUY',
    confidence: 84,
    timeframe: '15M',
    analysis: 'Institutional Liquidity Sweep & Bullish Order Block Rejection',
    timestamp: '12:45',
    entryPrice: 2648.5,
    stopLoss: 2638.0,
    takeProfit: 2670.0,
  },
  {
    id: 'sig-2',
    symbol: 'XAU/USD',
    direction: 'BUY',
    confidence: 79,
    timeframe: '15M',
    analysis: 'Fair Value Gap (FVG) Retest with Delta Volume Absorption',
    timestamp: '11:22',
    entryPrice: 2642.0,
    stopLoss: 2632.5,
    takeProfit: 2662.0,
  },
  {
    id: 'sig-3',
    symbol: 'XAU/USD',
    direction: 'SELL',
    confidence: 74,
    timeframe: '1H',
    analysis: 'Asian Session High Sweep & Bearish Market Structure Shift',
    timestamp: '10:15',
    entryPrice: 2658.0,
    stopLoss: 2666.5,
    takeProfit: 2641.0,
  },
];

const INITIAL_LOGS: ActivityLogEntry[] = [
  { id: 'l1', time: '12:45:10', text: 'Scanning XAU/USD order book depth & liquidity pools...', type: 'scan' },
  { id: 'l2', time: '12:44:52', text: 'Analyzing XAU/USD institutional market structure...', type: 'analyze' },
  { id: 'l3', time: '12:44:30', text: 'Checking momentum & RSI divergence on XAU/USD 15M...', type: 'analyze' },
  { id: 'l4', time: '12:44:12', text: 'XAU/USD signal confidence: 84% (High Probability)', type: 'signal' },
  { id: 'l5', time: '12:43:55', text: 'Confirming algorithmic risk parameters on XAU/USD...', type: 'analyze' },
  { id: 'l6', time: '12:43:40', text: 'Castimo Neural Engine online • MT5 Bridge Connected to Gold Desk', type: 'system' },
];

// Audio synthesizer for optional, subtle futuristic feedback
class SoundSynthesizer {
  private ctx: AudioContext | null = null;

  private init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
  }

  public playBlip(freq = 880, duration = 0.06) {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, this.ctx.currentTime + duration);

      gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch {
      // Audio autoplay policy handled gracefully
    }
  }

  public playSignalAlert() {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.08); // A5
      osc.frequency.setValueAtTime(1174.66, now + 0.16); // D6

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(now + 0.28);
    } catch {
      // Fail quietly
    }
  }
}

export const soundSynth = new SoundSynthesizer();

class AiRobotEngine {
  private state: AiRobotState;
  private listeners: Set<() => void> = new Set();
  private stepIndex: number = 0;
  private currentPairIndex: number = 0;
  private timer: NodeJS.Timeout | null = null;

  private readonly PAIRS = [
    { symbol: 'XAUUSD', display: 'XAU/USD', basePrice: 2651.8, digits: 2 },
  ];

  constructor() {
    this.state = {
      state: 'SCANNING',
      currentTask: 'Scanning XAU/USD order book depth & liquidity pools...',
      currentMarket: 'XAU/USD',
      timeframe: '15M',
      progress: 45,
      confidence: 84,
      isOnline: true,
      metrics: {
        rsi: 62,
        macd: 'POSITIVE',
        trend: 'BULLISH',
        momentum: 'STRONG',
        volume: 'HIGH',
        liquidity: 'OPTIMAL',
        volatility: 'MODERATE',
      },
      markets: INITIAL_MARKETS,
      currentSignal: INITIAL_RECENT_SIGNALS[0],
      recentSignals: INITIAL_RECENT_SIGNALS,
      logs: INITIAL_LOGS,
      soundEnabled: false,
    };

    this.startLoop();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  public getState(): AiRobotState {
    return this.state;
  }

  public toggleSound(): boolean {
    this.state.soundEnabled = !this.state.soundEnabled;
    if (this.state.soundEnabled) {
      soundSynth.playBlip(980, 0.08);
    }
    this.notify();
    return this.state.soundEnabled;
  }

  private addLog(text: string, type: 'scan' | 'analyze' | 'signal' | 'system') {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const newLog: ActivityLogEntry = {
      id: `log-${Date.now()}-${Math.random()}`,
      time: timeStr,
      text,
      type,
    };
    this.state.logs = [newLog, ...this.state.logs.slice(0, 30)];
  }

  private startLoop() {
    if (this.timer) clearInterval(this.timer);

    // Continuous tick loop every 2.4 seconds
    this.timer = setInterval(() => {
      this.advanceSequence();
    }, 2400);
  }

  private advanceSequence() {
    this.stepIndex = (this.stepIndex + 1) % 6;
    const currentPairObj = this.PAIRS[this.currentPairIndex];
    const pairName = currentPairObj.display;

    // Simulate minor price ticks for realism
    this.state.markets = this.state.markets.map((m) => {
      const delta = (Math.random() - 0.49) * (m.price * 0.0004);
      const newPrice = +(m.price + delta).toFixed(m.symbol === 'USDJPY' ? 2 : m.symbol === 'XAUUSD' ? 2 : 4);
      return {
        ...m,
        price: newPrice,
      };
    });

    switch (this.stepIndex) {
      case 0: {
        // SCANNING
        this.state.state = 'SCANNING';
        this.state.currentTask = `Scanning ${pairName} liquidity pools...`;
        this.state.currentMarket = pairName;
        this.state.progress = 25;
        this.state.metrics.rsi = Math.floor(48 + Math.random() * 12);
        this.state.metrics.momentum = 'MODERATE';
        this.addLog(`Scanning ${pairName} order book depth...`, 'scan');
        if (this.state.soundEnabled) soundSynth.playBlip(640, 0.04);
        break;
      }

      case 1: {
        // ANALYZING (Market Structure)
        this.state.state = 'ANALYZING';
        this.state.currentTask = `Analyzing ${pairName} market structure...`;
        this.state.progress = 52;
        this.state.metrics.rsi = Math.floor(55 + Math.random() * 15);
        this.state.metrics.macd = 'POSITIVE';
        this.state.metrics.liquidity = 'OPTIMAL';
        this.addLog(`Analyzing ${pairName} support/resistance structure...`, 'analyze');
        if (this.state.soundEnabled) soundSynth.playBlip(720, 0.04);
        break;
      }

      case 2: {
        // ANALYZING (Momentum & Indicators)
        this.state.state = 'ANALYZING';
        this.state.currentTask = `Evaluating momentum & volume profile on 15M...`;
        this.state.progress = 78;
        this.state.metrics.momentum = 'STRONG';
        this.state.metrics.volume = 'HIGH';
        this.state.metrics.volatility = 'EXPANDING';
        this.state.confidence = Math.floor(72 + Math.random() * 16);
        this.addLog(`Evaluating momentum indicators on ${pairName}...`, 'analyze');
        if (this.state.soundEnabled) soundSynth.playBlip(800, 0.04);
        break;
      }

      case 3: {
        // CONFIRMING
        this.state.state = 'CONFIRMING';
        this.state.currentTask = `Confirming setup • Confidence: ${this.state.confidence}%`;
        this.state.progress = 92;
        this.addLog(`Algorithmic confluence confirmed at ${this.state.confidence}%`, 'analyze');
        if (this.state.soundEnabled) soundSynth.playBlip(880, 0.05);
        break;
      }

      case 4: {
        // SIGNAL_DETECTED
        this.state.state = 'SIGNAL_DETECTED';
        const isBuy = Math.random() > 0.4;
        const dir = isBuy ? 'BUY' : 'SELL';
        const p = currentPairObj.basePrice;
        const slOffset = currentPairObj.symbol === 'XAUUSD' ? 8.5 : 0.0035;
        const tpOffset = currentPairObj.symbol === 'XAUUSD' ? 18.0 : 0.0075;

        const newSignal: AiSignal = {
          id: `sig-${Date.now()}`,
          symbol: pairName,
          direction: dir,
          confidence: this.state.confidence,
          timeframe: '15M',
          analysis: isBuy ? 'Institutional Order Block Retest' : 'Fair Value Gap Liquidity Rejection',
          timestamp: new Date().toTimeString().split(' ')[0].substring(0, 5),
          entryPrice: p,
          stopLoss: +(isBuy ? p - slOffset : p + slOffset).toFixed(currentPairObj.digits),
          takeProfit: +(isBuy ? p + tpOffset : p - tpOffset).toFixed(currentPairObj.digits),
        };

        this.state.currentSignal = newSignal;
        this.state.recentSignals = [newSignal, ...this.state.recentSignals.slice(0, 4)];
        this.state.currentTask = `${dir} SIGNAL DETECTED: ${pairName}`;
        this.state.progress = 100;

        // Update market status
        this.state.markets = this.state.markets.map((m) =>
          m.symbol === currentPairObj.symbol
            ? { ...m, status: 'SIGNAL', direction: dir, confidence: this.state.confidence }
            : m
        );

        this.addLog(`${dir} signal detected on ${pairName} (${this.state.confidence}%)`, 'signal');
        if (this.state.soundEnabled) soundSynth.playSignalAlert();
        break;
      }

      case 5: {
        // WAITING / COOLING DOWN
        this.state.state = 'WAITING';
        this.state.currentTask = `Refreshing XAU/USD liquidity depth & order flow...`;
        this.state.progress = 10;
        this.currentPairIndex = (this.currentPairIndex + 1) % this.PAIRS.length;
        this.addLog(`Cycle completed for ${pairName}. Refreshing liquidity depth.`, 'system');
        break;
      }
    }

    this.notify();
  }
}

export const aiRobotEngine = new AiRobotEngine();
