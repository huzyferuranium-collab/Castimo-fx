/**
 * The steps the Connect window shows while an account is being connected, and which of them are really done.
 *
 * A step is only ticked once what it says has happened: "Your broker accepts the login" is ticked when the broker's login
 * has been seen working (the server moves on to reading the balance), never before. It imports nothing, so it can be tested
 * on its own.
 */

export type StepState = 'done' | 'active' | 'todo';

export interface ConnectStep {
  key: string;
  text: string;
  state: StepState;
}

/** The server's stages (see clientBridge.ts) that belong to each step, in order. */
const STEPS: Array<{ key: string; text: string; stages: string[] }> = [
  { key: 'checking', text: 'Checking your details', stages: ['queued', 'checking'] },
  { key: 'creating', text: 'Adding your account', stages: ['creating', 'deploying'] },
  { key: 'syncing', text: 'Your broker accepts the login', stages: ['syncing'] },
  { key: 'verifying', text: 'Reading your balance', stages: ['verifying'] },
];

/** The steps with their state for the stage the server reports. An unknown stage starts at the first step. */
export function connectSteps(stage: string): ConnectStep[] {
  const found = STEPS.findIndex((s) => s.stages.includes(stage));
  const current = stage === 'done' ? STEPS.length : found === -1 ? 0 : found;
  return STEPS.map((s, i) => ({ key: s.key, text: s.text, state: i < current ? 'done' : i === current ? 'active' : 'todo' }));
}

/** True while the account is added and only the broker's answer is awaited: the client can safely leave the window. */
export function mayLeaveWindow(stage: string): boolean {
  return stage === 'syncing' || stage === 'verifying';
}

/**
 * Once a connection has finished, must the browser still ask the server to switch copying on? Not when the server says the account is
 * already in service (it puts a new connection into service itself, and a second round trip to the copier only kept the window waiting).
 * Yes for an account it kept paused, and whenever the answer is unclear: asking is what has always been done.
 */
export function needsCopyResume(status: unknown): boolean {
  return String(status ?? '').toUpperCase() !== 'ACTIVE';
}
