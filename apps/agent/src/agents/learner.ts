import { learnConventions } from '../learn.js';
import { say, type Agent } from '../bus.js';
import type { Deps } from '../loop.js';

// The learner agent: proposes conventions from past closes. Writes nothing (a human saves a convention). Not wired at startup, as today.
const NAME = 'learner', MAY = [] as const;

async function learn(deps: Deps, projectId: bigint, closes: { sourceId: number; text: string }[]) {
  const c = await learnConventions(closes);
  await say(deps.ledger, NAME, projectId, 'learn', `${c.proposals.length} convention proposal(s) from ${closes.length} close(s)`);
  return c;
}

export const learner = { name: NAME, seat: 'convention learner', may: MAY, handlers: { learn } } satisfies Agent<unknown>;
