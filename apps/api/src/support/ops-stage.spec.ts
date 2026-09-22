import { defaultStage, isOpsStage, opsStageOf } from './ops-stage';

describe('operational stage', () => {
  it('reads what the team set', () => {
    expect(opsStageOf({ stage: 'paused' }, 'ACTIVE')).toBe('paused');
    expect(opsStageOf({ stage: 'stopped' }, 'ACTIVE')).toBe('stopped');
  });

  // The team's label wins over the access switch: a salon Stripe still has as
  // ACTIVE can be one the owner asked us to pause, and the list must say so.
  it('is independent of the access status once set', () => {
    expect(opsStageOf({ stage: 'running' }, 'PENDING')).toBe('running');
    expect(opsStageOf({ stage: 'setup' }, 'ACTIVE')).toBe('setup');
  });

  it('starts every unlabelled salon from its access status', () => {
    expect(defaultStage('PENDING')).toBe('setup');
    expect(defaultStage('ACTIVE')).toBe('running');
    expect(defaultStage('SUSPENDED')).toBe('paused');
    expect(defaultStage('CANCELLED')).toBe('stopped');
    expect(defaultStage(undefined)).toBe('running');
  });

  it('never shows a blank or unknown label', () => {
    expect(opsStageOf(null, 'ACTIVE')).toBe('running');
    expect(opsStageOf({}, 'PENDING')).toBe('setup');
    expect(opsStageOf({ stage: 'archived' }, 'ACTIVE')).toBe('running');
    expect(opsStageOf('garbage', 'SUSPENDED')).toBe('paused');
  });

  it('accepts only the four stages', () => {
    expect(isOpsStage('setup')).toBe(true);
    expect(isOpsStage('SUSPENDED')).toBe(false);
    expect(isOpsStage('')).toBe(false);
    expect(isOpsStage(null)).toBe(false);
  });
});
